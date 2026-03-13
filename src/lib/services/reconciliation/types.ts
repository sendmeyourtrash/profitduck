export type ReconciliationStatus =
  | "unreconciled"
  | "partially_reconciled"
  | "reconciled"
  | "discrepancy_detected";

export type AlertType =
  | "payout_mismatch"
  | "deposit_mismatch"
  | "missing_payout"
  | "missing_deposit"
  | "duplicate_suspected";

export type AlertSeverity = "info" | "warning" | "error";

export interface ReconciliationChain {
  id: string; // payout ID or synthetic ID for orphans
  platform: string;
  periodStart: string;
  periodEnd: string;
  level1: {
    orderCount: number;
    totalAmount: number;
    orders: Array<{
      id: string;
      orderId: string;
      netPayout: number;
      date: string;
    }>;
  };
  level2: {
    payout: {
      id: string;
      grossAmount: number;
      fees: number;
      netAmount: number;
      date: string;
    } | null;
  };
  level3: {
    bankTransaction: {
      id: string;
      amount: number;
      date: string;
      description: string;
    } | null;
  };
  status: ReconciliationStatus;
  l1L2Variance: number | null;
  l2L3Variance: number | null;
}

export interface ReconciliationSummary {
  totalExpectedRevenue: number;
  totalPayoutAmount: number;
  totalBankDeposits: number;
  l1L2Variance: number;
  l2L3Variance: number;
  reconciledChains: number;
  partialChains: number;
  discrepancyChains: number;
  unreconciledChains: number;
  activeAlerts: number;
}

export interface ReconciliationSuggestion {
  payoutId: string;
  payoutPlatform: string;
  payoutDate: string;
  payoutAmount: number;
  bankTransactionId: string;
  bankDate: string;
  bankDescription: string;
  bankAmount: number;
  amountDiff: number;
  daysDiff: number;
  confidence: number;
}
