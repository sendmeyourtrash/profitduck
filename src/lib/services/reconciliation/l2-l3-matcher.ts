import { prisma } from "../../db/prisma";
import { ReconciliationSuggestion } from "./types";

const MATCH_TOLERANCE = 1.0;
const DATE_WINDOW_DAYS = 5;

/**
 * Find potential matches between unreconciled payouts (L2) and bank deposits (L3).
 *
 * DoorDash (and potentially other platforms) deposit a single combined bank
 * transfer for all channels (e.g. Marketplace + Storefront) under the same
 * platform payout ID.  This function groups payouts that share a
 * platformPayoutId and compares the *group total* against bank deposits,
 * then falls back to individual matching for payouts without a shared ID.
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

  // ── Group payouts that share a platformPayoutId ──
  // The bank deposit is for the combined amount across all channels.
  const groupedByPayoutId = new Map<
    string,
    typeof payouts
  >();
  const ungroupedPayouts: typeof payouts = [];

  for (const payout of payouts) {
    if (payout.platformPayoutId) {
      const key = `${payout.platform}:${payout.platformPayoutId}`;
      if (!groupedByPayoutId.has(key)) {
        groupedByPayoutId.set(key, []);
      }
      groupedByPayoutId.get(key)!.push(payout);
    } else {
      ungroupedPayouts.push(payout);
    }
  }

  // Match grouped payouts (combined amount) against bank deposits.
  // Also account for orphan orders: orders with a platformPayoutId but no
  // corresponding payout record (e.g. Storefront orders when only the
  // Marketplace payout was imported). The bank deposit includes these amounts.
  for (const [key, group] of groupedByPayoutId) {
    const payoutTotal = group.reduce((sum, p) => sum + p.netAmount, 0);

    // Check for orphan orders: same platformPayoutId but linked to none
    // of the payouts in this group (i.e. their channel's payout is missing)
    const platformPayoutId = group[0].platformPayoutId!;
    const platform = group[0].platform;
    const groupPayoutIds = group.map((p) => p.id);
    const orphanOrders = await prisma.platformOrder.findMany({
      where: {
        platform,
        platformPayoutId,
        linkedPayoutId: null,
      },
      select: { netPayout: true },
    });
    const orphanTotal = orphanOrders.reduce(
      (sum, o) => sum + o.netPayout,
      0
    );

    const combinedAmount = payoutTotal + orphanTotal;
    // Use the earliest payout date in the group as the reference date
    const refDate = group.reduce(
      (earliest, p) =>
        p.payoutDate < earliest ? p.payoutDate : earliest,
      group[0].payoutDate
    );
    const refPlatform = platform;

    for (const bank of bankDeposits) {
      const amountDiff = Math.abs(combinedAmount - bank.amount);
      const daysDiff = Math.abs(
        (refDate.getTime() - bank.date.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (amountDiff <= MATCH_TOLERANCE && daysDiff <= DATE_WINDOW_DAYS) {
        const amountConfidence = 1 - amountDiff / MATCH_TOLERANCE;
        const dateConfidence = 1 - daysDiff / DATE_WINDOW_DAYS;
        const confidence = amountConfidence * 0.6 + dateConfidence * 0.4;

        const descLower = bank.description.toLowerCase();
        const platformBonus = descLower.includes(refPlatform.toLowerCase())
          ? 0.15
          : 0;

        // Create a suggestion for the first payout in the group;
        // confirmL2L3Match will link all payouts in the group
        suggestions.push({
          payoutId: group[0].id,
          payoutPlatform: refPlatform,
          payoutDate: refDate.toISOString(),
          payoutAmount: combinedAmount,
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

  // Match ungrouped payouts individually (original logic)
  for (const payout of ungroupedPayouts) {
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
 * Validates that the bank transaction exists before linking.
 *
 * When the payout has a platformPayoutId, all payouts sharing that ID
 * (e.g. Marketplace + Storefront channel splits) are linked to the same
 * bank transaction, since the bank receives a single combined deposit.
 */
export async function confirmL2L3Match(
  payoutId: string,
  bankTransactionId: string
): Promise<void> {
  // Validate that the bank transaction exists
  const bankTx = await prisma.bankTransaction.findUnique({
    where: { id: bankTransactionId },
  });
  if (!bankTx) {
    throw new Error(
      `Bank transaction ${bankTransactionId} not found — may have been deleted`
    );
  }

  // Find the primary payout and any siblings sharing the same platformPayoutId
  const primaryPayout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });
  if (!primaryPayout) {
    throw new Error(`Payout ${payoutId} not found`);
  }

  // Collect all payout IDs to link (primary + siblings)
  let payoutIdsToLink = [payoutId];
  if (primaryPayout.platformPayoutId) {
    const siblings = await prisma.payout.findMany({
      where: {
        platform: primaryPayout.platform,
        platformPayoutId: primaryPayout.platformPayoutId,
        bankTransactionId: null,
      },
      select: { id: true },
    });
    payoutIdsToLink = siblings.map((s) => s.id);
  }

  await prisma.$transaction(async (tx) => {
    // Link all payouts in the group to this bank transaction
    for (const pid of payoutIdsToLink) {
      const linkedOrders = await tx.platformOrder.count({
        where: { linkedPayoutId: pid },
      });
      const status = linkedOrders > 0 ? "reconciled" : "partially_reconciled";

      await tx.payout.update({
        where: { id: pid },
        data: {
          bankTransactionId,
          reconciliationStatus: status,
        },
      });
    }

    await tx.bankTransaction.update({
      where: { id: bankTransactionId },
      data: {
        reconciled: true,
        reconciliationStatus: "reconciled",
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
        reconciliationStatus:
          linkedOrders > 0 ? "partially_reconciled" : "unreconciled",
      },
    });
  });
}

/**
 * Auto-match all high-confidence L2-L3 suggestions.
 * Tracks both used bank transaction IDs and payout IDs to prevent
 * duplicate payouts from each getting a different bank transaction.
 * Returns count of matches made.
 */
export async function autoMatchL2L3(minConfidence = 0.9): Promise<number> {
  const suggestions = await findL2L3Suggestions();
  const usedBankTxIds = new Set<string>();
  const usedPayoutIds = new Set<string>();
  let count = 0;

  for (const s of suggestions) {
    if (
      s.confidence >= minConfidence &&
      !usedBankTxIds.has(s.bankTransactionId) &&
      !usedPayoutIds.has(s.payoutId)
    ) {
      try {
        await confirmL2L3Match(s.payoutId, s.bankTransactionId);
        usedBankTxIds.add(s.bankTransactionId);
        usedPayoutIds.add(s.payoutId);
        count++;
      } catch {
        // Skip if bank transaction doesn't exist (caught by validation)
        continue;
      }
    }
  }

  return count;
}
