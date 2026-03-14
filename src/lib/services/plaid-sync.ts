/**
 * Plaid transaction sync — fetches from Plaid /transactions/sync,
 * maps to BankTransaction + Transaction, deduplicates, and stores.
 * Mirrors the square-sync.ts pattern.
 */

import type { Transaction as PlaidTransaction } from "plaid";
import { prisma } from "../db/prisma";
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
import { isTransactionDuplicate, isBankTransactionDuplicate } from "./dedup";
import type { ProgressCallback } from "./progress";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaidSyncResult {
  added: number;
  modified: number;
  removed: number;
  skipped: number;
  totalFetched: number;
  importId: string;
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function syncPlaidTransactions(
  onProgress?: ProgressCallback
): Promise<PlaidSyncResult> {
  await initializePlaidFromDb();
  const accessToken = getRuntimeAccessToken();
  if (!accessToken) {
    throw new Error("Plaid is not configured. Connect your bank account first.");
  }

  const client = getPlaidClient();

  // Create Import record for audit trail
  const importRecord = await prisma.import.create({
    data: {
      source: "chase-plaid",
      fileName: `Plaid Sync (${new Date().toISOString().split("T")[0]})`,
      status: "processing",
      rowsProcessed: 0,
      rowsFailed: 0,
      rowsSkipped: 0,
    },
  });

  const result: PlaidSyncResult = {
    added: 0,
    modified: 0,
    removed: 0,
    skipped: 0,
    totalFetched: 0,
    importId: importRecord.id,
  };

  try {
    onProgress?.({
      phase: "fetching",
      current: 0,
      total: 0,
      message: "Fetching transactions from Plaid...",
    });

    // Read stored cursor (empty string = initial full sync)
    const cursor = (await getPlaidCursor()) || "";

    // Collect all transaction updates
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

      // Small delay to avoid rate limiting
      if (hasMore) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Get institution/account info for mapping
    const institutionName =
      (await getSetting(SETTING_KEYS.PLAID_INSTITUTION_NAME)) || "Chase";
    const accountName =
      (await getSetting(SETTING_KEYS.PLAID_ACCOUNT_NAME)) || "Checking";

    // Process added transactions
    onProgress?.({
      phase: "storing",
      current: 0,
      total: allAdded.length,
      message: `Processing ${allAdded.length} new transactions...`,
    });

    for (let i = 0; i < allAdded.length; i++) {
      const plaidTx = allAdded[i];
      const mapped = mapPlaidTransaction(plaidTx, institutionName, accountName);

      // Check for duplicates (by rawSourceId or date+amount+description)
      const txDup = await isTransactionDuplicate({
        rawSourceId: mapped.transaction.rawSourceId,
        sourcePlatform: mapped.transaction.sourcePlatform,
        date: mapped.transaction.date,
        amount: mapped.transaction.amount,
        description: mapped.transaction.description,
      });

      if (txDup) {
        result.skipped++;
      } else {
        // Create both BankTransaction and Transaction
        const btDup = await isBankTransactionDuplicate({
          date: mapped.bankTransaction.date,
          amount: mapped.bankTransaction.amount,
          description: mapped.bankTransaction.description,
        });

        if (!btDup) {
          await prisma.bankTransaction.create({
            data: {
              ...mapped.bankTransaction,
              importId: importRecord.id,
            },
          });
        }

        await prisma.transaction.create({
          data: {
            ...mapped.transaction,
            importId: importRecord.id,
          },
        });

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

    // Process modified transactions (update existing by rawSourceId)
    for (const plaidTx of allModified) {
      const mapped = mapPlaidTransaction(plaidTx, institutionName, accountName);

      const existing = await prisma.transaction.findFirst({
        where: {
          rawSourceId: plaidTx.transaction_id,
          sourcePlatform: "chase",
        },
      });

      if (existing) {
        await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            amount: mapped.transaction.amount,
            description: mapped.transaction.description,
            category: mapped.transaction.category,
            type: mapped.transaction.type,
          },
        });
        result.modified++;
      }
    }

    // Process removed transactions (delete by rawSourceId)
    for (const removed of allRemoved) {
      const existing = await prisma.transaction.findFirst({
        where: {
          rawSourceId: removed.transaction_id,
          sourcePlatform: "chase",
        },
      });

      if (existing) {
        await prisma.transaction.delete({
          where: { id: existing.id },
        });
        result.removed++;
      }
    }

    // Save cursor ONLY after successful processing
    await setPlaidCursorDb(currentCursor);
    await setPlaidLastSyncAt(new Date().toISOString());

    // Update Import record
    await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        status: "completed",
        rowsProcessed: result.totalFetched,
        rowsSkipped: result.skipped,
      },
    });

    onProgress?.({
      phase: "done",
      current: 1,
      total: 1,
      message: "Sync complete",
    });

    return result;
  } catch (error) {
    // Mark import as failed
    await prisma.import.update({
      where: { id: importRecord.id },
      data: {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
      },
    });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Field mapping — Plaid → BankTransaction + Transaction
// Matches the output of src/lib/parsers/chase.ts
// ---------------------------------------------------------------------------

interface MappedRecords {
  bankTransaction: {
    date: Date;
    description: string;
    amount: number;
    category: string | undefined;
    rawData: string;
    accountType: string | undefined;
    accountName: string | undefined;
    institutionName: string;
  };
  transaction: {
    date: Date;
    amount: number;
    type: string;
    sourcePlatform: string;
    category: string | undefined;
    description: string;
    rawSourceId: string;
    rawData: string;
  };
}

function mapPlaidTransaction(
  plaidTx: PlaidTransaction,
  institutionName: string,
  accountName: string
): MappedRecords {
  const rawData = JSON.stringify(plaidTx);
  const date = new Date(plaidTx.date);

  // Plaid sign convention: positive = money leaving account (debit/expense)
  // Chase CSV convention: negative = money leaving account (debit/expense)
  // Our DB follows Chase CSV: negative = debit, positive = credit
  const bankAmount = plaidTx.amount * -1;

  const description = plaidTx.name || plaidTx.merchant_name || "Unknown";

  // Extract category from Plaid's personal_finance_category
  const category =
    plaidTx.personal_finance_category?.primary?.toLowerCase().replace(/_/g, " ") ||
    plaidTx.category?.[0] ||
    undefined;

  // Transaction amount is always positive, type indicates direction
  const isCredit = bankAmount > 0;

  return {
    bankTransaction: {
      date,
      description,
      amount: bankAmount,
      category,
      rawData,
      accountType: undefined, // Will be set from account info if available
      accountName,
      institutionName,
    },
    transaction: {
      date,
      amount: Math.abs(bankAmount),
      type: isCredit ? "income" : "expense",
      sourcePlatform: "chase",
      category: category || (isCredit ? "deposit" : "expense"),
      description,
      rawSourceId: plaidTx.transaction_id,
      rawData,
    },
  };
}
