/**
 * One-time cleanup service:
 * 1. Link existing expenses to their corresponding bank transactions
 * 2. Remove duplicate bank transactions across import sources
 *    (e.g. same checking account transaction from both Chase and Rocket Money)
 */

import { prisma } from "../db/prisma";

export interface CleanupResult {
  expensesLinked: number;
  expensesAlreadyLinked: number;
  expensesUnmatched: number;
  duplicatesRemoved: number;
  duplicatesSkipped: number;
}

/**
 * Link all unlinked expenses to their corresponding bank transactions.
 * Matches by date (±1 day) + amount (sign-adjusted).
 * Prefers bank transactions from the same import (same Rocket Money row).
 */
async function linkExpensesToBankTransactions(): Promise<{
  linked: number;
  alreadyLinked: number;
  unmatched: number;
}> {
  const expenses = await prisma.expense.findMany({
    where: { linkedBankTransactionId: null },
    select: { id: true, date: true, amount: true, importId: true },
  });

  let linked = 0;
  let unmatched = 0;
  const alreadyLinked = await prisma.expense.count({
    where: { linkedBankTransactionId: { not: null } },
  });

  // Track which bank transactions have already been linked in this run
  // to avoid linking the same bank tx to multiple expenses
  const usedBankTxIds = new Set<string>();

  for (const exp of expenses) {
    const dayBefore = new Date(exp.date);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(exp.date);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const bankAmount = -Math.abs(exp.amount);

    // First try: same import (both from same Rocket Money row)
    let matchId: string | null = null;

    if (exp.importId) {
      const sameImport = await prisma.bankTransaction.findFirst({
        where: {
          date: { gte: dayBefore, lte: dayAfter },
          amount: bankAmount,
          importId: exp.importId,
          id: { notIn: [...usedBankTxIds] },
          linkedExpenses: { none: {} },
        },
        select: { id: true },
      });
      matchId = sameImport?.id || null;
    }

    // Fallback: any unlinked bank transaction
    if (!matchId) {
      const anyMatch = await prisma.bankTransaction.findFirst({
        where: {
          date: { gte: dayBefore, lte: dayAfter },
          amount: bankAmount,
          id: { notIn: [...usedBankTxIds] },
          linkedExpenses: { none: {} },
        },
        select: { id: true },
      });
      matchId = anyMatch?.id || null;
    }

    if (matchId) {
      await prisma.expense.update({
        where: { id: exp.id },
        data: { linkedBankTransactionId: matchId },
      });
      usedBankTxIds.add(matchId);
      linked++;
    } else {
      unmatched++;
    }
  }

  return { linked, alreadyLinked, unmatched };
}

/**
 * Remove duplicate bank transactions across import sources.
 * When the same transaction exists from both Chase and Rocket Money
 * (same account, same date, same amount), keep the Rocket Money one
 * (has richer metadata) and delete the Chase duplicate.
 *
 * Moves any FK references to the kept record first.
 */
async function deduplicateBankTransactions(): Promise<{
  removed: number;
  skipped: number;
}> {
  // Find all checking account bank transactions grouped by source
  const allBankTxs = await prisma.bankTransaction.findMany({
    where: { accountName: "BUS COMPLETE CHK" },
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      importId: true,
      import: { select: { source: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group Rocket Money transactions by date+amount for lookup
  const rmByDateAmount = new Map<string, string>(); // key → rmBankTxId
  const chaseIds: Array<{ id: string; date: Date; amount: number }> = [];

  for (const bt of allBankTxs) {
    const source = bt.import?.source || "";
    const key = `${bt.date.toISOString()}|${bt.amount}`;

    if (source === "rocketmoney") {
      // Keep first Rocket Money record for each date+amount
      if (!rmByDateAmount.has(key)) {
        rmByDateAmount.set(key, bt.id);
      }
    } else if (source === "chase-statements") {
      chaseIds.push({ id: bt.id, date: bt.date, amount: bt.amount });
    }
  }

  let removed = 0;
  let skipped = 0;

  for (const chase of chaseIds) {
    // Check exact date+amount match first
    let key = `${chase.date.toISOString()}|${chase.amount}`;
    let rmId = rmByDateAmount.get(key);

    // Also try ±1 day window (timezone differences between sources)
    if (!rmId) {
      const dayBefore = new Date(chase.date);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(chase.date);
      dayAfter.setDate(dayAfter.getDate() + 1);

      for (const [k, v] of rmByDateAmount) {
        const [dateStr, amtStr] = k.split("|");
        const d = new Date(dateStr);
        if (
          d >= dayBefore &&
          d <= dayAfter &&
          parseFloat(amtStr) === chase.amount
        ) {
          rmId = v;
          break;
        }
      }
    }

    if (!rmId) {
      skipped++;
      continue;
    }

    // Move any FK references from Chase record to Rocket Money record
    await prisma.$transaction(async (tx) => {
      // Move payout links
      await tx.payout.updateMany({
        where: { bankTransactionId: chase.id },
        data: { bankTransactionId: rmId },
      });

      // Move transaction links
      await tx.transaction.updateMany({
        where: { linkedBankTransactionId: chase.id },
        data: { linkedBankTransactionId: rmId },
      });

      // Move expense links
      await tx.expense.updateMany({
        where: { linkedBankTransactionId: chase.id },
        data: { linkedBankTransactionId: rmId },
      });

      // Delete the Chase duplicate
      await tx.bankTransaction.delete({ where: { id: chase.id } });
    });

    removed++;
  }

  return { removed, skipped };
}

/**
 * Run the full cleanup: link expenses, then dedup bank transactions.
 */
export async function runBankTransactionCleanup(): Promise<CleanupResult> {
  console.log("[Cleanup] Starting expense ↔ bank transaction cleanup...");

  // Step 1: Link expenses to bank transactions
  console.log("[Cleanup] Phase 1: Linking expenses to bank transactions...");
  const linkResult = await linkExpensesToBankTransactions();
  console.log(
    `[Cleanup] Linked ${linkResult.linked} expenses, ${linkResult.alreadyLinked} already linked, ${linkResult.unmatched} unmatched`
  );

  // Step 2: Remove duplicate bank transactions
  console.log(
    "[Cleanup] Phase 2: Removing duplicate bank transactions..."
  );
  const dedupResult = await deduplicateBankTransactions();
  console.log(
    `[Cleanup] Removed ${dedupResult.removed} duplicates, ${dedupResult.skipped} skipped`
  );

  return {
    expensesLinked: linkResult.linked,
    expensesAlreadyLinked: linkResult.alreadyLinked,
    expensesUnmatched: linkResult.unmatched,
    duplicatesRemoved: dedupResult.removed,
    duplicatesSkipped: dedupResult.skipped,
  };
}
