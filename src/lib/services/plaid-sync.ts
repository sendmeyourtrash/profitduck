/**
 * Plaid transaction sync — fetches from Plaid /transactions/sync,
 * maps to bank.db transactions table entries (source='plaid'), deduplicates, and stores.
 */

import type { Transaction as PlaidTransaction } from "plaid";
import Database from "better-sqlite3";
import path from "path";
import {
  getPlaidClient,
  getRuntimeAccessToken,
  initializePlaidFromDb,
} from "./plaid-api";
import {
  getPlaidCursor,
  setPlaidCursorDb,
  setPlaidLastSyncAt,
  getSetting,
  SETTING_KEYS,
} from "./settings";
import { createImport, getCategoriesDb } from "../db/config-db";
import type { ProgressCallback } from "./progress";

const DB_DIR = path.join(process.cwd(), "databases");

export interface PlaidSyncResult {
  added: number;
  modified: number;
  removed: number;
  skipped: number;
  totalFetched: number;
  importId: string;
}

export async function syncPlaidTransactions(
  onProgress?: ProgressCallback
): Promise<PlaidSyncResult> {
  await initializePlaidFromDb();
  const accessToken = getRuntimeAccessToken();
  if (!accessToken) {
    throw new Error("Plaid is not configured. Connect your bank account first.");
  }

  const client = getPlaidClient();

  // Create Import record for tracking
  const importId = createImport(
    `Plaid Sync (${new Date().toISOString().split("T")[0]})`,
    "chase-plaid",
    0
  );

  const result: PlaidSyncResult = {
    added: 0,
    modified: 0,
    removed: 0,
    skipped: 0,
    totalFetched: 0,
    importId: String(importId),
  };

  try {
    onProgress?.({
      phase: "fetching",
      current: 0,
      total: 0,
      message: "Fetching transactions from Plaid...",
    });

    const cursor = (await getPlaidCursor()) || "";

    const allAdded: PlaidTransaction[] = [];
    const allModified: PlaidTransaction[] = [];
    const allRemoved: { transaction_id: string }[] = [];

    let hasMore = true;
    let currentCursor = cursor;

    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor: currentCursor || undefined,
        count: 500,
      });

      const data = response.data;
      allAdded.push(...data.added);
      allModified.push(...data.modified);
      allRemoved.push(...data.removed);

      hasMore = data.has_more;
      currentCursor = data.next_cursor;

      result.totalFetched += data.added.length + data.modified.length + data.removed.length;

      onProgress?.({
        phase: "fetching",
        current: result.totalFetched,
        total: 0,
        message: `Fetched ${result.totalFetched} transaction updates...`,
      });

      if (hasMore) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const institutionName =
      (await getSetting(SETTING_KEYS.PLAID_INSTITUTION_NAME)) || "Chase";
    const accountName =
      (await getSetting(SETTING_KEYS.PLAID_ACCOUNT_NAME)) || "Checking";

    // Store in bank.db
    const bankDb = new Database(path.join(DB_DIR, "bank.db"));

    try {
      onProgress?.({
        phase: "storing",
        current: 0,
        total: allAdded.length,
        message: `Processing ${allAdded.length} new transactions...`,
      });

      const insert = bankDb.prepare(
        `INSERT INTO transactions (date, name, description, amount, category, account_name, note, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'plaid')`
      );

      for (let i = 0; i < allAdded.length; i++) {
        const plaidTx = allAdded[i];
        const dateStr = plaidTx.date; // yyyy-MM-dd
        const description = plaidTx.name || plaidTx.merchant_name || "Unknown";
        const bankAmount = plaidTx.amount * -1; // Plaid: positive = debit; we want negative = debit
        const category =
          plaidTx.personal_finance_category?.primary?.toLowerCase().replace(/_/g, " ") ||
          plaidTx.category?.[0] ||
          "Uncategorized";

        // Check for duplicate in bank.db
        const existing = bankDb.prepare(
          `SELECT 1 FROM transactions WHERE date = ? AND amount = ? AND name = ? AND source = 'plaid'`
        ).get(dateStr, bankAmount, description);

        if (existing) {
          result.skipped++;
        } else {
          insert.run(
            dateStr,
            description,
            description,
            bankAmount,
            category,
            `${institutionName} - ${accountName}`,
            `plaid:${plaidTx.transaction_id}`
          );
          result.added++;
        }

        if ((i + 1) % 25 === 0) {
          onProgress?.({
            phase: "storing",
            current: i + 1,
            total: allAdded.length,
            message: `Stored ${i + 1} of ${allAdded.length} transactions...`,
          });
        }
      }

      // Handle removed transactions
      for (const removed of allRemoved) {
        const existing = bankDb.prepare(
          `SELECT id FROM transactions WHERE note = ? AND source = 'plaid'`
        ).get(`plaid:${removed.transaction_id}`) as { id: number } | undefined;

        if (existing) {
          bankDb.prepare("DELETE FROM transactions WHERE id = ?").run(existing.id);
          result.removed++;
        }
      }
    } finally {
      bankDb.close();
    }

    // Save cursor
    await setPlaidCursorDb(currentCursor);
    await setPlaidLastSyncAt(new Date().toISOString());

    // Update Import record
    getCategoriesDb().prepare(
      "UPDATE imports SET status = 'completed', records_count = ? WHERE id = ?"
    ).run(result.totalFetched, importId);

    onProgress?.({
      phase: "done",
      current: 1,
      total: 1,
      message: "Sync complete",
    });

    return result;
  } catch (error) {
    getCategoriesDb().prepare(
      "UPDATE imports SET status = 'failed' WHERE id = ?"
    ).run(importId);
    throw error;
  }
}
