import { prisma } from "../../db/prisma";
import type { AlertType } from "./types";

const MATCH_TOLERANCE = 1.0;
const DATE_WINDOW_DAYS = 3;

interface L1L2Result {
  matched: number;
  unmatched: number;
  discrepancies: number;
  alerts: Array<{ type: AlertType; message: string; details: string }>;
}

/**
 * Match L1 atomic events (PlatformOrders) to L2 payouts.
 * Strategy varies by platform since each has different payout patterns.
 */
export async function matchLevel1ToLevel2(
  platform?: string
): Promise<L1L2Result> {
  const platforms = platform
    ? [platform]
    : ["doordash", "ubereats", "grubhub", "square"];

  const combined: L1L2Result = {
    matched: 0,
    unmatched: 0,
    discrepancies: 0,
    alerts: [],
  };

  for (const p of platforms) {
    const result = await matchPlatform(p);
    combined.matched += result.matched;
    combined.unmatched += result.unmatched;
    combined.discrepancies += result.discrepancies;
    combined.alerts.push(...result.alerts);
  }

  return combined;
}

async function matchPlatform(platform: string): Promise<L1L2Result> {
  const result: L1L2Result = {
    matched: 0,
    unmatched: 0,
    discrepancies: 0,
    alerts: [],
  };

  // Get all payouts for this platform that haven't been fully linked
  const payouts = await prisma.payout.findMany({
    where: { platform },
    orderBy: { payoutDate: "asc" },
    include: { platformOrders: true },
  });

  if (payouts.length === 0) {
    // No payouts — try to match orders directly to bank transactions
    await matchOrdersWithoutPayouts(platform, result);
    return result;
  }

  // Get all unlinked orders for this platform
  const unlinkedOrders = await prisma.platformOrder.findMany({
    where: {
      platform,
      linkedPayoutId: null,
    },
    orderBy: { orderDatetime: "asc" },
  });

  if (unlinkedOrders.length === 0) {
    return result;
  }

  // For each payout, find orders in its date window
  for (const payout of payouts) {
    const payoutDate = payout.payoutDate.getTime();
    const windowStart = payoutDate - DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // Find orders that fall before this payout (within window)
    const candidateOrders = unlinkedOrders.filter((o) => {
      const orderTime = o.orderDatetime.getTime();
      return orderTime <= payoutDate && orderTime >= windowStart;
    });

    if (candidateOrders.length === 0) continue;

    // Sum the net payouts of candidate orders
    const orderTotal = candidateOrders.reduce(
      (sum, o) => sum + o.netPayout,
      0
    );
    const variance = Math.abs(orderTotal - payout.netAmount);

    // Link orders to this payout
    const orderIds = candidateOrders.map((o) => o.id);
    await prisma.platformOrder.updateMany({
      where: { id: { in: orderIds } },
      data: {
        linkedPayoutId: payout.id,
        reconciliationStatus:
          variance <= MATCH_TOLERANCE ? "reconciled" : "discrepancy_detected",
      },
    });

    // Also link matching income transactions
    const rawSourceIds = candidateOrders.map((o) => o.orderId);
    if (rawSourceIds.length > 0) {
      await prisma.transaction.updateMany({
        where: {
          sourcePlatform: platform,
          rawSourceId: { in: rawSourceIds },
          linkedPayoutId: null,
        },
        data: { linkedPayoutId: payout.id },
      });
    }

    // Remove linked orders from the unlinked pool
    for (const id of orderIds) {
      const idx = unlinkedOrders.findIndex((o) => o.id === id);
      if (idx >= 0) unlinkedOrders.splice(idx, 1);
    }

    // Update payout with computed amounts
    const payoutStatus =
      variance <= MATCH_TOLERANCE
        ? payout.bankTransactionId
          ? "reconciled"
          : "partially_reconciled"
        : "discrepancy_detected";

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        expectedAmount: orderTotal,
        amountVariance: orderTotal - payout.netAmount,
        reconciliationStatus: payoutStatus,
      },
    });

    if (variance <= MATCH_TOLERANCE) {
      result.matched += candidateOrders.length;
    } else {
      result.discrepancies++;
      result.alerts.push({
        type: "payout_mismatch",
        message: `${platform} payout $${payout.netAmount.toFixed(2)} differs from order total $${orderTotal.toFixed(2)}`,
        details: JSON.stringify({
          payoutId: payout.id,
          payoutAmount: payout.netAmount,
          orderTotal,
          variance: orderTotal - payout.netAmount,
          orderCount: candidateOrders.length,
        }),
      });
    }
  }

  // Remaining unlinked orders
  result.unmatched += unlinkedOrders.length;

  return result;
}

/**
 * For platforms without explicit payout records (e.g., Square where payouts
 * go directly to bank), try to group daily orders and match to bank transactions.
 */
async function matchOrdersWithoutPayouts(
  platform: string,
  result: L1L2Result
): Promise<void> {
  const unlinkedOrders = await prisma.platformOrder.findMany({
    where: {
      platform,
      linkedPayoutId: null,
    },
    orderBy: { orderDatetime: "asc" },
  });

  if (unlinkedOrders.length === 0) return;

  // Group orders by date
  const dailyGroups = new Map<string, typeof unlinkedOrders>();
  for (const order of unlinkedOrders) {
    const dateKey = order.orderDatetime.toISOString().split("T")[0];
    if (!dailyGroups.has(dateKey)) {
      dailyGroups.set(dateKey, []);
    }
    dailyGroups.get(dateKey)!.push(order);
  }

  // For each daily group, try to find a matching bank transaction
  for (const [dateKey, orders] of dailyGroups) {
    const dailyTotal = orders.reduce((sum, o) => sum + o.netPayout, 0);
    if (dailyTotal === 0) continue;

    const dateStart = new Date(dateKey);
    const dateEnd = new Date(dateKey);
    dateEnd.setDate(dateEnd.getDate() + DATE_WINDOW_DAYS);

    // Look for a bank transaction matching the daily total
    const bankTx = await prisma.bankTransaction.findFirst({
      where: {
        reconciled: false,
        amount: {
          gte: dailyTotal - MATCH_TOLERANCE,
          lte: dailyTotal + MATCH_TOLERANCE,
        },
        date: { gte: dateStart, lte: dateEnd },
        description: { contains: platform },
      },
    });

    if (bankTx) {
      // Link transactions directly to bank transaction
      const orderIds = orders.map((o) => o.id);
      const rawSourceIds = orders.map((o) => o.orderId);

      await prisma.platformOrder.updateMany({
        where: { id: { in: orderIds } },
        data: { reconciliationStatus: "reconciled" },
      });

      if (rawSourceIds.length > 0) {
        await prisma.transaction.updateMany({
          where: {
            sourcePlatform: platform,
            rawSourceId: { in: rawSourceIds },
            linkedBankTransactionId: null,
          },
          data: {
            linkedBankTransactionId: bankTx.id,
            reconciliationStatus: "reconciled",
          },
        });
      }

      await prisma.bankTransaction.update({
        where: { id: bankTx.id },
        data: {
          reconciled: true,
          reconciliationStatus: "reconciled",
        },
      });

      result.matched += orders.length;
    } else {
      result.unmatched += orders.length;
    }
  }
}
