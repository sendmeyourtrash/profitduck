// Barrel re-exports for the reconciliation module
export type {
  ReconciliationStatus,
  AlertType,
  AlertSeverity,
  ReconciliationChain,
  ReconciliationSummary,
  ReconciliationSuggestion,
} from "./types";

export {
  findL2L3Suggestions,
  confirmL2L3Match,
  undoL2L3Match,
  autoMatchL2L3,
} from "./l2-l3-matcher";

export { matchLevel1ToLevel2, resetReconciliationLinks } from "./l1-l2-matcher";

export {
  buildReconciliationChains,
  getReconciliationSummary,
} from "./chain-builder";

export {
  runAlertScan,
  getActiveAlerts,
  resolveAlert,
} from "./alert-engine";

// Backward-compatible wrappers matching original reconciliation.ts API
import { findL2L3Suggestions, confirmL2L3Match, undoL2L3Match } from "./l2-l3-matcher";
import { prisma } from "../../db/prisma";

export const findReconciliationSuggestions = findL2L3Suggestions;
export const reconcileMatch = confirmL2L3Match;
export const unreconcileMatch = undoL2L3Match;

export async function getReconciliationStats() {
  const [totalPayouts, reconciledPayouts, totalBankTx, reconciledBankTx] =
    await Promise.all([
      prisma.payout.count(),
      prisma.payout.count({ where: { bankTransactionId: { not: null } } }),
      prisma.bankTransaction.count({ where: { amount: { gt: 0 } } }),
      prisma.bankTransaction.count({ where: { reconciled: true } }),
    ]);

  return {
    totalPayouts,
    reconciledPayouts,
    unreconciledPayouts: totalPayouts - reconciledPayouts,
    totalBankDeposits: totalBankTx,
    reconciledBankDeposits: reconciledBankTx,
    unreconciledBankDeposits: totalBankTx - reconciledBankTx,
    reconciliationRate:
      totalPayouts > 0
        ? Math.round((reconciledPayouts / totalPayouts) * 100)
        : 0,
  };
}
