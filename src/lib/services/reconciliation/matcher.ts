/**
 * Reconciliation Matcher — L1 (sales.db orders) → L3 (bank.db deposits)
 *
 * Groups platform orders by deposit windows and matches them to bank deposits.
 * Square deposits are batched (not daily), so we group by deposit pattern.
 * Other platforms deposit per-order or weekly.
 */

import Database from "better-sqlite3";
import path from "path";
import {
  clearReconMatches,
  insertReconMatch,
  insertReconAlert,
} from "@/lib/db/config-db";

const DB_DIR = path.join(process.cwd(), "databases");

interface OrderGroup {
  platform: string;
  startDate: string;
  endDate: string;
  orderCount: number;
  expectedAmount: number;
}

interface BankDeposit {
  id: number;
  date: string;
  amount: number;
  name: string;
}

const PLATFORM_BANK_PATTERNS: Record<string, string[]> = {
  square: ["%Square%"],
  grubhub: ["%GrubHub%", "%Grubhub%"],
  doordash: ["%DoorDash%", "%DOORDASH%"],
  ubereats: ["%Uber%"],
};

const AMOUNT_TOLERANCE = 5.0; // $5 tolerance for matching
const DATE_WINDOW_DAYS = 7; // look ±7 days for deposit

export interface MatchResult {
  groupsCreated: number;
  matched: number;
  unmatched: number;
  alertsCreated: number;
}

export function runReconciliation(): MatchResult {
  const salesDb = new Database(path.join(DB_DIR, "sales.db"), { readonly: true });
  const bankDb = new Database(path.join(DB_DIR, "bank.db"), { readonly: true });

  try {
    // Clear previous results
    clearReconMatches();

    let groupsCreated = 0;
    let matched = 0;
    let unmatched = 0;
    let alertsCreated = 0;

    for (const [platform, bankPatterns] of Object.entries(PLATFORM_BANK_PATTERNS)) {
      // --- Get order groups by week ---
      const orderGroups = salesDb.prepare(
        `SELECT
          strftime('%Y-W%W', date) as week,
          MIN(date) as start_date,
          MAX(date) as end_date,
          COUNT(*) as order_count,
          ROUND(SUM(net_sales), 2) as total_net
         FROM orders
         WHERE order_status = 'completed' AND platform = ?
         GROUP BY week
         ORDER BY week ASC`
      ).all(platform) as { week: string; start_date: string; end_date: string; order_count: number; total_net: number }[];

      // --- Get bank deposits for this platform ---
      const likeClauses = bankPatterns.map(() => "name LIKE ?").join(" OR ");
      const bankDeposits = bankDb.prepare(
        `SELECT id, date, ABS(CAST(amount AS REAL)) as amount, name
         FROM rocketmoney
         WHERE CAST(amount AS REAL) < 0 AND (${likeClauses})
         ORDER BY date ASC`
      ).all(...bankPatterns) as BankDeposit[];

      // Track which bank deposits are already used
      const usedBankIds = new Set<number>();

      for (const group of orderGroups) {
        groupsCreated++;

        // Find best matching bank deposit
        let bestMatch: BankDeposit | null = null;
        let bestScore = Infinity;

        for (const deposit of bankDeposits) {
          if (usedBankIds.has(deposit.id)) continue;

          // Check date window
          const depositDate = new Date(deposit.date + "T12:00:00");
          const groupEnd = new Date(group.end_date + "T12:00:00");
          const daysDiff = (depositDate.getTime() - groupEnd.getTime()) / 86400000;

          if (daysDiff < -DATE_WINDOW_DAYS || daysDiff > DATE_WINDOW_DAYS) continue;

          // Check amount similarity
          const amountDiff = Math.abs(deposit.amount - group.total_net);
          if (amountDiff > group.total_net * 0.5 && amountDiff > AMOUNT_TOLERANCE) continue;

          // Score: prefer closer amounts and closer dates
          const score = amountDiff + Math.abs(daysDiff) * 10;
          if (score < bestScore) {
            bestScore = score;
            bestMatch = deposit;
          }
        }

        if (bestMatch) {
          usedBankIds.add(bestMatch.id);
          const variance = Math.round((bestMatch.amount - group.total_net) * 100) / 100;
          insertReconMatch({
            platform,
            order_group_start: group.start_date,
            order_group_end: group.end_date,
            order_count: group.order_count,
            expected_amount: group.total_net,
            bank_tx_id: bestMatch.id,
            bank_date: bestMatch.date,
            bank_amount: bestMatch.amount,
            variance,
            status: Math.abs(variance) < AMOUNT_TOLERANCE ? "matched" : "discrepancy",
          });
          matched++;

          if (Math.abs(variance) >= AMOUNT_TOLERANCE) {
            insertReconAlert(
              "amount_discrepancy",
              Math.abs(variance) > 50 ? "error" : "warning",
              `${platform} week ${group.start_date}–${group.end_date}: expected $${group.total_net.toFixed(2)}, bank deposit $${bestMatch.amount.toFixed(2)} (variance $${variance.toFixed(2)})`,
              platform
            );
            alertsCreated++;
          }
        } else {
          insertReconMatch({
            platform,
            order_group_start: group.start_date,
            order_group_end: group.end_date,
            order_count: group.order_count,
            expected_amount: group.total_net,
            bank_tx_id: null,
            bank_date: null,
            bank_amount: null,
            variance: null,
            status: "unmatched",
          });
          unmatched++;

          insertReconAlert(
            "missing_deposit",
            "warning",
            `No bank deposit found for ${platform} orders ${group.start_date}–${group.end_date} ($${group.total_net.toFixed(2)})`,
            platform
          );
          alertsCreated++;
        }
      }

      // Check for unmatched bank deposits (deposits with no order group)
      for (const deposit of bankDeposits) {
        if (usedBankIds.has(deposit.id)) continue;
        insertReconAlert(
          "unmatched_deposit",
          "info",
          `Unmatched ${platform} bank deposit on ${deposit.date}: $${deposit.amount.toFixed(2)}`,
          platform
        );
        alertsCreated++;
      }
    }

    return { groupsCreated, matched, unmatched, alertsCreated };
  } finally {
    salesDb.close();
    bankDb.close();
  }
}
