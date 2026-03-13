import { prisma } from "../../db/prisma";
import type { AlertType, AlertSeverity } from "./types";

const PAYOUT_MISMATCH_TOLERANCE = 1.0;
const MISSING_PAYOUT_DAYS = 3;
const MISSING_DEPOSIT_DAYS = 5;

interface NewAlert {
  type: AlertType;
  severity: AlertSeverity;
  platform?: string;
  message: string;
  details?: string;
  payoutId?: string;
  bankTransactionId?: string;
}

/**
 * Run a full alert scan. Creates alerts idempotently (won't duplicate existing unresolved alerts).
 * Returns count of new alerts created.
 */
export async function runAlertScan(): Promise<number> {
  const alerts: NewAlert[] = [];

  await Promise.all([
    scanPayoutMismatches(alerts),
    scanDepositMismatches(alerts),
    scanMissingPayouts(alerts),
    scanMissingDeposits(alerts),
    scanDuplicates(alerts),
  ]);

  // Create alerts idempotently
  let created = 0;
  for (const alert of alerts) {
    const existing = await prisma.reconciliationAlert.findFirst({
      where: {
        type: alert.type,
        resolved: false,
        payoutId: alert.payoutId || null,
        bankTransactionId: alert.bankTransactionId || null,
      },
    });

    if (!existing) {
      await prisma.reconciliationAlert.create({
        data: {
          type: alert.type,
          severity: alert.severity,
          platform: alert.platform || null,
          message: alert.message,
          details: alert.details || null,
          payoutId: alert.payoutId || null,
          bankTransactionId: alert.bankTransactionId || null,
        },
      });
      created++;
    }
  }

  return created;
}

/**
 * Check payouts where L1 order totals don't match payout net amount.
 */
async function scanPayoutMismatches(alerts: NewAlert[]): Promise<void> {
  const payouts = await prisma.payout.findMany({
    where: {
      expectedAmount: { not: null },
    },
    select: {
      id: true,
      platform: true,
      netAmount: true,
      expectedAmount: true,
      amountVariance: true,
    },
  });

  for (const p of payouts) {
    if (
      p.amountVariance !== null &&
      Math.abs(p.amountVariance) > PAYOUT_MISMATCH_TOLERANCE
    ) {
      alerts.push({
        type: "payout_mismatch",
        severity: Math.abs(p.amountVariance) > 10 ? "error" : "warning",
        platform: p.platform,
        message: `${p.platform} payout $${p.netAmount.toFixed(2)} differs from L1 order total $${(p.expectedAmount || 0).toFixed(2)} (variance: $${(p.amountVariance || 0).toFixed(2)})`,
        details: JSON.stringify({
          payoutAmount: p.netAmount,
          expectedAmount: p.expectedAmount,
          variance: p.amountVariance,
        }),
        payoutId: p.id,
      });
    }
  }
}

/**
 * Check payouts where bank deposit amount doesn't match payout net amount.
 */
async function scanDepositMismatches(alerts: NewAlert[]): Promise<void> {
  const payouts = await prisma.payout.findMany({
    where: {
      bankTransactionId: { not: null },
    },
    include: { bankTransaction: true },
  });

  for (const p of payouts) {
    if (!p.bankTransaction) continue;
    const diff = Math.abs(p.netAmount - p.bankTransaction.amount);
    if (diff > PAYOUT_MISMATCH_TOLERANCE) {
      alerts.push({
        type: "deposit_mismatch",
        severity: diff > 10 ? "error" : "warning",
        platform: p.platform,
        message: `${p.platform} payout $${p.netAmount.toFixed(2)} doesn't match bank deposit $${p.bankTransaction.amount.toFixed(2)}`,
        details: JSON.stringify({
          payoutAmount: p.netAmount,
          bankAmount: p.bankTransaction.amount,
          difference: diff,
        }),
        payoutId: p.id,
        bankTransactionId: p.bankTransaction.id,
      });
    }
  }
}

/**
 * Find L1 orders older than MISSING_PAYOUT_DAYS with no linked payout.
 */
async function scanMissingPayouts(alerts: NewAlert[]): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MISSING_PAYOUT_DAYS);

  const platforms = ["doordash", "ubereats", "grubhub"];

  for (const platform of platforms) {
    const count = await prisma.platformOrder.count({
      where: {
        platform,
        linkedPayoutId: null,
        orderDatetime: { lt: cutoff },
      },
    });

    if (count > 0) {
      const total = await prisma.platformOrder.aggregate({
        where: {
          platform,
          linkedPayoutId: null,
          orderDatetime: { lt: cutoff },
        },
        _sum: { netPayout: true },
      });

      alerts.push({
        type: "missing_payout",
        severity: "warning",
        platform,
        message: `${count} ${platform} orders (total $${(total._sum.netPayout || 0).toFixed(2)}) have no linked payout record`,
        details: JSON.stringify({
          orderCount: count,
          totalAmount: total._sum.netPayout || 0,
        }),
      });
    }
  }
}

/**
 * Find payouts older than MISSING_DEPOSIT_DAYS with no linked bank transaction.
 */
async function scanMissingDeposits(alerts: NewAlert[]): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MISSING_DEPOSIT_DAYS);

  const payouts = await prisma.payout.findMany({
    where: {
      bankTransactionId: null,
      payoutDate: { lt: cutoff },
    },
    select: { id: true, platform: true, netAmount: true, payoutDate: true },
  });

  for (const p of payouts) {
    alerts.push({
      type: "missing_deposit",
      severity: "warning",
      platform: p.platform,
      message: `${p.platform} payout of $${p.netAmount.toFixed(2)} from ${p.payoutDate.toISOString().split("T")[0]} has no matching bank deposit`,
      payoutId: p.id,
    });
  }
}

/**
 * Look for suspected duplicate transactions (same platform, amount, date).
 */
async function scanDuplicates(alerts: NewAlert[]): Promise<void> {
  const duplicates = await prisma.$queryRawUnsafe<
    { platform: string; amount: number; date: string; cnt: number }[]
  >(
    `SELECT platform, net_payout as amount, DATE(order_datetime) as date, COUNT(*) as cnt
     FROM platform_orders
     GROUP BY platform, net_payout, DATE(order_datetime)
     HAVING COUNT(*) > 3 AND net_payout > 10
     ORDER BY cnt DESC
     LIMIT 20`
  );

  for (const d of duplicates) {
    alerts.push({
      type: "duplicate_suspected",
      severity: "info",
      platform: d.platform,
      message: `${d.cnt} ${d.platform} orders with same amount $${d.amount.toFixed(2)} on ${d.date} — verify not duplicates`,
      details: JSON.stringify(d),
    });
  }
}

/**
 * Get all active (unresolved) alerts.
 */
export async function getActiveAlerts(filters?: {
  type?: string;
  severity?: string;
  platform?: string;
}) {
  const where: Record<string, unknown> = { resolved: false };
  if (filters?.type) where.type = filters.type;
  if (filters?.severity) where.severity = filters.severity;
  if (filters?.platform) where.platform = filters.platform;

  return prisma.reconciliationAlert.findMany({
    where,
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * Resolve an alert.
 */
export async function resolveAlert(
  alertId: string,
  resolvedBy: string = "manual"
): Promise<void> {
  await prisma.reconciliationAlert.update({
    where: { id: alertId },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy,
    },
  });
}
