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
 */
export async function isBankTransactionDuplicate(
  bt: {
    date: Date;
    amount: number;
    description: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient?: any
): Promise<boolean> {
  const db = prismaClient || prisma;
  const existing = await db.bankTransaction.findFirst({
    where: {
      date: bt.date,
      amount: bt.amount,
      description: bt.description,
    },
    select: { id: true },
  });
  return !!existing;
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
  const existing = await db.expense.findFirst({
    where: {
      date: exp.date,
      amount: exp.amount,
      vendor: { name: exp.vendorName },
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
