import { NextResponse } from "next/server";
import {
  findReconciliationSuggestions,
  getReconciliationStats,
  getReconciliationSummary,
  getActiveAlerts,
} from "@/lib/services/reconciliation";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [suggestions, stats, reconciledPairs, summary, alerts] =
    await Promise.all([
      findReconciliationSuggestions(),
      getReconciliationStats(),
      prisma.payout.findMany({
        where: { bankTransactionId: { not: null } },
        include: { bankTransaction: true },
        orderBy: { payoutDate: "desc" },
      }),
      getReconciliationSummary(),
      getActiveAlerts(),
    ]);

  return NextResponse.json({
    stats,
    suggestions,
    reconciledPairs: reconciledPairs.map((p) => ({
      payoutId: p.id,
      platform: p.platform,
      payoutDate: p.payoutDate.toISOString(),
      payoutAmount: p.netAmount,
      bankTransactionId: p.bankTransactionId,
      bankDate: p.bankTransaction?.date.toISOString(),
      bankDescription: p.bankTransaction?.description,
      bankAmount: p.bankTransaction?.amount,
    })),
    summary,
    alerts,
  });
}
