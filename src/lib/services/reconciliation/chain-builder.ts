import { prisma } from "../../db/prisma";
import type {
  ReconciliationChain,
  ReconciliationSummary,
  ReconciliationStatus,
} from "./types";

/**
 * Build reconciliation chains starting from L2 payouts as pivot points.
 * Each chain: L1 orders → L2 payout → L3 bank transaction.
 */
export async function buildReconciliationChains(
  platform?: string,
  startDate?: Date,
  endDate?: Date
): Promise<ReconciliationChain[]> {
  const chains: ReconciliationChain[] = [];

  // Build filter for payouts
  const where: Record<string, unknown> = {};
  if (platform) where.platform = platform;
  if (startDate || endDate) {
    where.payoutDate = {};
    if (startDate)
      (where.payoutDate as Record<string, Date>).gte = startDate;
    if (endDate) (where.payoutDate as Record<string, Date>).lte = endDate;
  }

  // Get all payouts with linked orders and bank transaction
  const payouts = await prisma.payout.findMany({
    where,
    include: {
      platformOrders: {
        select: {
          id: true,
          orderId: true,
          netPayout: true,
          orderDatetime: true,
        },
        orderBy: { orderDatetime: "asc" },
      },
      bankTransaction: true,
    },
    orderBy: { payoutDate: "desc" },
  });

  for (const payout of payouts) {
    const orderTotal = payout.platformOrders.reduce(
      (sum, o) => sum + o.netPayout,
      0
    );

    const l1L2Variance =
      payout.platformOrders.length > 0
        ? orderTotal - payout.netAmount
        : null;

    const l2L3Variance = payout.bankTransaction
      ? payout.netAmount - payout.bankTransaction.amount
      : null;

    const status = determineChainStatus(
      payout.platformOrders.length > 0,
      !!payout.bankTransaction,
      l1L2Variance,
      l2L3Variance
    );

    const dates = payout.platformOrders.map((o) =>
      o.orderDatetime.getTime()
    );
    const periodStart =
      dates.length > 0
        ? new Date(Math.min(...dates)).toISOString()
        : payout.payoutDate.toISOString();
    const periodEnd =
      dates.length > 0
        ? new Date(Math.max(...dates)).toISOString()
        : payout.payoutDate.toISOString();

    chains.push({
      id: payout.id,
      platform: payout.platform,
      periodStart,
      periodEnd,
      level1: {
        orderCount: payout.platformOrders.length,
        totalAmount: orderTotal,
        orders: payout.platformOrders.map((o) => ({
          id: o.id,
          orderId: o.orderId,
          netPayout: o.netPayout,
          date: o.orderDatetime.toISOString(),
        })),
      },
      level2: {
        payout: {
          id: payout.id,
          grossAmount: payout.grossAmount,
          fees: payout.fees,
          netAmount: payout.netAmount,
          date: payout.payoutDate.toISOString(),
        },
      },
      level3: {
        bankTransaction: payout.bankTransaction
          ? {
              id: payout.bankTransaction.id,
              amount: payout.bankTransaction.amount,
              date: payout.bankTransaction.date.toISOString(),
              description: payout.bankTransaction.description,
            }
          : null,
      },
      status,
      l1L2Variance,
      l2L3Variance,
    });
  }

  return chains;
}

function determineChainStatus(
  hasL1: boolean,
  hasL3: boolean,
  l1L2Var: number | null,
  l2L3Var: number | null
): ReconciliationStatus {
  // Check for discrepancies first
  if (l1L2Var !== null && Math.abs(l1L2Var) > 1.0) return "discrepancy_detected";
  if (l2L3Var !== null && Math.abs(l2L3Var) > 1.0) return "discrepancy_detected";

  // All three levels linked
  if (hasL1 && hasL3) return "reconciled";

  // At least one link exists
  if (hasL1 || hasL3) return "partially_reconciled";

  return "unreconciled";
}

/**
 * Get aggregate reconciliation summary across all platforms.
 */
export async function getReconciliationSummary(): Promise<ReconciliationSummary> {
  const [
    totalL1Revenue,
    totalPayoutAmount,
    totalBankDeposits,
    payoutStats,
    alertCount,
  ] = await Promise.all([
    // L1: Sum of all income transactions from platform parsers
    prisma.transaction.aggregate({
      where: { type: "income" },
      _sum: { amount: true },
    }),
    // L2: Sum of all payout net amounts
    prisma.payout.aggregate({
      _sum: { netAmount: true },
    }),
    // L3: Sum of reconciled bank deposits linked to payouts
    prisma.bankTransaction.aggregate({
      where: { reconciled: true },
      _sum: { amount: true },
    }),
    // Payout reconciliation status counts
    prisma.payout.groupBy({
      by: ["reconciliationStatus"],
      _count: true,
    }),
    // Active alerts
    prisma.reconciliationAlert.count({
      where: { resolved: false },
    }),
  ]);

  const l1Total = totalL1Revenue._sum.amount || 0;
  const l2Total = totalPayoutAmount._sum.netAmount || 0;
  const l3Total = totalBankDeposits._sum.amount || 0;

  const statusCounts = new Map(
    payoutStats.map((s) => [s.reconciliationStatus, s._count])
  );

  return {
    totalExpectedRevenue: l1Total,
    totalPayoutAmount: l2Total,
    totalBankDeposits: l3Total,
    l1L2Variance: l1Total - l2Total,
    l2L3Variance: l2Total - l3Total,
    reconciledChains: statusCounts.get("reconciled") || 0,
    partialChains: statusCounts.get("partially_reconciled") || 0,
    discrepancyChains: statusCounts.get("discrepancy_detected") || 0,
    unreconciledChains: statusCounts.get("unreconciled") || 0,
    activeAlerts: alertCount,
  };
}
