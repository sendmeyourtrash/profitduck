import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * GET /api/reconciliation/alerts/:alertId/details
 * Returns the full transaction context for a single alert — the orders,
 * payouts, and bank deposits that caused it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const { alertId } = await params;

  const alert = await prisma.reconciliationAlert.findUnique({
    where: { id: alertId },
  });

  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  const details = alert.details ? JSON.parse(alert.details) : {};

  switch (alert.type) {
    // ── Payout Mismatch / Deposit Mismatch ──
    // Show the payout, its linked orders, and the bank deposit
    case "payout_mismatch":
    case "deposit_mismatch": {
      if (!alert.payoutId) {
        return NextResponse.json({ alert, payout: null, orders: [], bankTransaction: null });
      }

      const payout = await prisma.payout.findUnique({
        where: { id: alert.payoutId },
        include: {
          bankTransaction: {
            select: {
              id: true,
              date: true,
              amount: true,
              description: true,
              accountName: true,
              institutionName: true,
            },
          },
        },
      });

      const orders = await prisma.platformOrder.findMany({
        where: { linkedPayoutId: alert.payoutId },
        select: {
          id: true,
          orderId: true,
          platform: true,
          orderDatetime: true,
          subtotal: true,
          tax: true,
          deliveryFee: true,
          serviceFee: true,
          commissionFee: true,
          tip: true,
          netPayout: true,
        },
        orderBy: { orderDatetime: "asc" },
      });

      return NextResponse.json({
        alert,
        payout: payout
          ? {
              id: payout.id,
              platform: payout.platform,
              payoutDate: payout.payoutDate,
              grossAmount: payout.grossAmount,
              fees: payout.fees,
              netAmount: payout.netAmount,
              expectedAmount: payout.expectedAmount,
              amountVariance: payout.amountVariance,
            }
          : null,
        orders,
        bankTransaction: payout?.bankTransaction || null,
      });
    }

    // ── Missing Payout ──
    // Show unlinked orders for this platform
    case "missing_payout": {
      const platform = alert.platform;
      if (!platform) {
        return NextResponse.json({ alert, orders: [] });
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 3);

      const orders = await prisma.platformOrder.findMany({
        where: {
          platform,
          linkedPayoutId: null,
          orderDatetime: { lt: cutoff },
        },
        select: {
          id: true,
          orderId: true,
          platform: true,
          orderDatetime: true,
          subtotal: true,
          tip: true,
          netPayout: true,
        },
        orderBy: { orderDatetime: "desc" },
        take: 25,
      });

      return NextResponse.json({ alert, orders });
    }

    // ── Missing Deposit ──
    // Show the payout and candidate bank deposits that could match
    case "missing_deposit": {
      if (!alert.payoutId) {
        return NextResponse.json({ alert, payout: null, candidateDeposits: [] });
      }

      const payout = await prisma.payout.findUnique({
        where: { id: alert.payoutId },
      });

      if (!payout) {
        return NextResponse.json({ alert, payout: null, candidateDeposits: [] });
      }

      // Find bank deposits within ±$2 and ±5 days of the payout
      const dateMin = new Date(payout.payoutDate);
      dateMin.setDate(dateMin.getDate() - 2);
      const dateMax = new Date(payout.payoutDate);
      dateMax.setDate(dateMax.getDate() + 5);

      const candidateDeposits = await prisma.bankTransaction.findMany({
        where: {
          amount: {
            gte: payout.netAmount - 2,
            lte: payout.netAmount + 2,
          },
          date: { gte: dateMin, lte: dateMax },
          // Only unlinked deposits
          payouts: { none: {} },
        },
        select: {
          id: true,
          date: true,
          amount: true,
          description: true,
          accountName: true,
        },
        orderBy: { date: "asc" },
        take: 10,
      });

      return NextResponse.json({
        alert,
        payout: {
          id: payout.id,
          platform: payout.platform,
          payoutDate: payout.payoutDate,
          grossAmount: payout.grossAmount,
          fees: payout.fees,
          netAmount: payout.netAmount,
        },
        candidateDeposits,
      });
    }

    // ── Duplicate Suspected ──
    // Show all orders matching the duplicate criteria
    case "duplicate_suspected": {
      const platform = details.platform || alert.platform;
      const amount = details.amount;
      const date = details.date;

      if (!platform || amount === undefined || !date) {
        return NextResponse.json({ alert, orders: [] });
      }

      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59.999`);

      const orders = await prisma.platformOrder.findMany({
        where: {
          platform,
          netPayout: { gte: amount - 0.01, lte: amount + 0.01 },
          orderDatetime: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          orderId: true,
          platform: true,
          orderDatetime: true,
          subtotal: true,
          tip: true,
          netPayout: true,
          linkedPayoutId: true,
        },
        orderBy: { orderDatetime: "asc" },
      });

      return NextResponse.json({ alert, orders });
    }

    default:
      return NextResponse.json({ alert });
  }
}
