import { prisma } from "../../db/prisma";
import { ReconciliationSuggestion } from "./types";

const MATCH_TOLERANCE = 1.0;
const DATE_WINDOW_DAYS = 5;

/**
 * Find potential matches between unreconciled payouts (L2) and bank deposits (L3).
 * Preserves the original matching algorithm with confidence scoring.
 */
export async function findL2L3Suggestions(): Promise<ReconciliationSuggestion[]> {
  const payouts = await prisma.payout.findMany({
    where: { bankTransactionId: null },
    orderBy: { payoutDate: "desc" },
  });

  const bankDeposits = await prisma.bankTransaction.findMany({
    where: {
      reconciled: false,
      amount: { gt: 0 },
    },
    orderBy: { date: "desc" },
  });

  const suggestions: ReconciliationSuggestion[] = [];

  for (const payout of payouts) {
    for (const bank of bankDeposits) {
      const amountDiff = Math.abs(payout.netAmount - bank.amount);
      const daysDiff = Math.abs(
        (payout.payoutDate.getTime() - bank.date.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      if (amountDiff <= MATCH_TOLERANCE && daysDiff <= DATE_WINDOW_DAYS) {
        const amountConfidence = 1 - amountDiff / MATCH_TOLERANCE;
        const dateConfidence = 1 - daysDiff / DATE_WINDOW_DAYS;
        const confidence = amountConfidence * 0.6 + dateConfidence * 0.4;

        const descLower = bank.description.toLowerCase();
        const platformBonus =
          descLower.includes(payout.platform.toLowerCase()) ? 0.15 : 0;

        suggestions.push({
          payoutId: payout.id,
          payoutPlatform: payout.platform,
          payoutDate: payout.payoutDate.toISOString(),
          payoutAmount: payout.netAmount,
          bankTransactionId: bank.id,
          bankDate: bank.date.toISOString(),
          bankDescription: bank.description,
          bankAmount: bank.amount,
          amountDiff,
          daysDiff: Math.round(daysDiff),
          confidence: Math.min(confidence + platformBonus, 1),
        });
      }
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}

/**
 * Confirm a L2-L3 match: link payout to bank transaction.
 */
export async function confirmL2L3Match(
  payoutId: string,
  bankTransactionId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Check if payout has L1 links to determine full status
    const linkedOrders = await tx.platformOrder.count({
      where: { linkedPayoutId: payoutId },
    });

    const status = linkedOrders > 0 ? "reconciled" : "partially_reconciled";

    await tx.payout.update({
      where: { id: payoutId },
      data: {
        bankTransactionId,
        reconciliationStatus: status,
      },
    });

    await tx.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        reconciled: true,
        reconciliationStatus: status,
      },
    });
  });
}

/**
 * Undo a L2-L3 match.
 */
export async function undoL2L3Match(payoutId: string): Promise<void> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });

  if (!payout || !payout.bankTransactionId) {
    throw new Error("Payout not found or not reconciled");
  }

  await prisma.$transaction(async (tx) => {
    // Check if payout still has L1 links
    const linkedOrders = await tx.platformOrder.count({
      where: { linkedPayoutId: payoutId },
    });

    await tx.bankTransaction.update({
      where: { id: payout.bankTransactionId! },
      data: {
        reconciled: false,
        reconciliationStatus: "unreconciled",
      },
    });

    await tx.payout.update({
      where: { id: payoutId },
      data: {
        bankTransactionId: null,
        reconciliationStatus: linkedOrders > 0 ? "partially_reconciled" : "unreconciled",
      },
    });
  });
}

/**
 * Auto-match all high-confidence L2-L3 suggestions.
 * Returns count of matches made.
 */
export async function autoMatchL2L3(minConfidence = 0.9): Promise<number> {
  const suggestions = await findL2L3Suggestions();
  const matched = new Set<string>(); // track used bank transaction IDs
  let count = 0;

  for (const s of suggestions) {
    if (s.confidence >= minConfidence && !matched.has(s.bankTransactionId)) {
      await confirmL2L3Match(s.payoutId, s.bankTransactionId);
      matched.add(s.bankTransactionId);
      count++;
    }
  }

  return count;
}
