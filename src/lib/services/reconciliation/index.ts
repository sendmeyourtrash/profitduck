/**
 * Reconciliation module — L1 (sales.db orders) → L3 (bank.db deposits)
 *
 * Simplified two-layer reconciliation that matches platform sales
 * directly to bank deposits, without requiring an intermediate payout layer.
 */

export { runReconciliation } from "./matcher";
export type { MatchResult } from "./matcher";

export {
  getReconMatches,
  getReconAlerts,
  getReconSummary,
  resolveReconAlert,
  updateReconMatch,
  unmatchReconMatch,
  clearReconMatches,
} from "@/lib/db/config-db";

// Backward-compatible stats wrapper for health-report
export function getReconciliationStats() {
  const summary = require("@/lib/db/config-db").getReconSummary();
  return {
    totalPayouts: summary.total,
    reconciledPayouts: summary.matched,
    unreconciledPayouts: summary.unmatched,
    totalBankDeposits: 0,
    reconciledBankDeposits: 0,
    unreconciledBankDeposits: 0,
    reconciliationRate: summary.rate,
  };
}
