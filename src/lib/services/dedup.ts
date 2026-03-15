import { createHash } from "crypto";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma";

/**
 * Compute SHA256 hash of a file's contents.
 */
export function computeFileHash(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Check if an exact duplicate file has already been imported.
 * Returns the matching import if found.
 */
export async function checkDuplicateFile(fileHash: string) {
  return prisma.import.findFirst({
    where: {
      fileHash,
      status: { in: ["completed", "processing"] },
    },
    orderBy: { importedAt: "desc" },
  });
}

/**
 * Check for overlapping time ranges with existing imports from the same source.
 * Returns imports whose date range overlaps with the given range.
 */
export async function checkOverlappingImports(
  source: string,
  dateRangeStart: Date,
  dateRangeEnd: Date
) {
  return prisma.import.findMany({
    where: {
      source,
      status: "completed",
      dateRangeStart: { not: null },
      dateRangeEnd: { not: null },
      AND: [
        { dateRangeStart: { lte: dateRangeEnd } },
        { dateRangeEnd: { gte: dateRangeStart } },
      ],
    },
    orderBy: { importedAt: "desc" },
  });
}

/**
 * Deduplicate a transaction by checking for existing records with same
 * rawSourceId + sourcePlatform, or same date + amount + description.
 * Returns true if the transaction is a duplicate and should be skipped.
 */
export async function isTransactionDuplicate(
  tx: {
    rawSourceId?: string | null;
    sourcePlatform: string;
    date: Date;
    amount: number;
    description?: string | null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient?: any
): Promise<boolean> {
  const db = prismaClient || prisma;

  // Check by rawSourceId first (most reliable)
  if (tx.rawSourceId) {
    const existing = await db.transaction.findFirst({
      where: {
        rawSourceId: tx.rawSourceId,
        sourcePlatform: tx.sourcePlatform,
      },
      select: { id: true },
    });
    if (existing) return true;
  }

  // Check by date + amount + description (fuzzy match)
  const existing = await db.transaction.findFirst({
    where: {
      sourcePlatform: tx.sourcePlatform,
      date: tx.date,
      amount: tx.amount,
      description: tx.description || null,
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Check if a bank transaction is a duplicate.
 *
 * Two-phase check:
 * 1. Primary: exact match on date + amount + description (same-source re-imports)
 * 2. Fallback: date (±1 day) + amount + accountName (cross-source dedup,
 *    e.g. Chase vs Rocket Money for the same bank account where descriptions differ)
 */
export async function isBankTransactionDuplicate(
  bt: {
    date: Date;
    amount: number;
    description: string;
    accountName?: string | null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient?: any
): Promise<boolean> {
  const db = prismaClient || prisma;

  // Primary: exact match on date + amount + description
  const exactMatch = await db.bankTransaction.findFirst({
    where: {
      date: bt.date,
      amount: bt.amount,
      description: bt.description,
    },
    select: { id: true },
  });
  if (exactMatch) return true;

  // Fallback: cross-source dedup using date (±1 day) + amount + same account
  // This catches duplicates where Chase and Rocket Money have different
  // descriptions for the same transaction (e.g. "Orig CO Name:Square Inc..."
  // vs "Square - ORIG CO NAME:Square Inc...")
  if (bt.accountName) {
    const dayBefore = new Date(bt.date);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(bt.date);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const crossSourceMatch = await db.bankTransaction.findFirst({
      where: {
        date: { gte: dayBefore, lte: dayAfter },
        amount: bt.amount,
        accountName: bt.accountName,
      },
      select: { id: true },
    });
    if (crossSourceMatch) return true;
  }

  return false;
}

/**
 * Find a matching bank transaction for an expense.
 * Used to link expenses to their corresponding bank transaction at ingestion time.
 *
 * Matching criteria: date (±1 day) + amount (sign-adjusted: expenses are positive,
 * bank transactions are negative for outflows).
 *
 * Returns the bank transaction ID if found, null otherwise.
 * Prefers unlinked bank transactions (no existing expense link).
 */
export async function findMatchingBankTransaction(
  exp: {
    date: Date;
    amount: number;
    importId?: string | null;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient?: any
): Promise<string | null> {
  const db = prismaClient || prisma;

  const dayBefore = new Date(exp.date);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(exp.date);
  dayAfter.setDate(dayAfter.getDate() + 1);

  // Expenses are stored as positive amounts, bank transactions as negative
  // for outflows. Match on the negative equivalent.
  const bankAmount = -Math.abs(exp.amount);

  // First try: same import (both came from the same Rocket Money row)
  if (exp.importId) {
    const sameImport = await db.bankTransaction.findFirst({
      where: {
        date: { gte: dayBefore, lte: dayAfter },
        amount: bankAmount,
        importId: exp.importId,
        linkedExpenses: { none: {} },
      },
      select: { id: true },
    });
    if (sameImport) return sameImport.id;
  }

  // Fallback: any unlinked bank transaction with matching date + amount
  const anyMatch = await db.bankTransaction.findFirst({
    where: {
      date: { gte: dayBefore, lte: dayAfter },
      amount: bankAmount,
      linkedExpenses: { none: {} },
    },
    select: { id: true },
  });
  return anyMatch?.id || null;
}

/**
 * Check if an expense is a duplicate.
 */
export async function isExpenseDuplicate(
  exp: {
    date: Date;
    amount: number;
    vendorName: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient?: any
): Promise<boolean> {
  const db = prismaClient || prisma;

  // Use a ±1 day window instead of exact date to catch timezone-shifted
  // duplicates (e.g. Chase stores midnight UTC, Rocket Money stores
  // midnight local → same transaction appears 16 hours apart).
  const dayBefore = new Date(exp.date);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(exp.date);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const existing = await db.expense.findFirst({
    where: {
      date: { gte: dayBefore, lte: dayAfter },
      amount: exp.amount,
      vendor: { name: exp.vendorName },
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Check if a payout is a duplicate.
 * Primary: check by platformPayoutId + platform (exact match, most reliable).
 * Fallback: check by platform + payoutDate + netAmount.
 */
export async function isPayoutDuplicate(
  payout: {
    platformPayoutId?: string | null;
    platform: string;
    payoutDate: Date;
    netAmount: number;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient?: any
): Promise<boolean> {
  const db = prismaClient || prisma;

  // Primary: by platform payout ID + net amount (exact match).
  // We include netAmount because DoorDash can split a single payout ID
  // across channels (Marketplace, Storefront) with different amounts.
  if (payout.platformPayoutId) {
    const existing = await db.payout.findFirst({
      where: {
        platform: payout.platform,
        platformPayoutId: payout.platformPayoutId,
        netAmount: payout.netAmount,
      },
      select: { id: true },
    });
    if (existing) return true;
  }

  // Fallback: same platform, date, and net amount
  const existing = await db.payout.findFirst({
    where: {
      platform: payout.platform,
      payoutDate: payout.payoutDate,
      netAmount: payout.netAmount,
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Compute the date range covered by a set of parsed records.
 */
export function computeDateRange(
  dates: Date[]
): { start: Date; end: Date } | null {
  if (dates.length === 0) return null;

  let min = dates[0];
  let max = dates[0];

  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }

  return { start: min, end: max };
}
