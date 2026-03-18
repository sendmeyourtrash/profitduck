/**
 * Cross-Source Dedup — Permanent DB-level duplicate marking.
 *
 * Ports the proven algorithm from `bank-activity-grouping.ts` (display-level)
 * to write `duplicateOfId` in the database. No hardcoded vendor names —
 * matching is purely by amount, date, and source platform.
 *
 * Pass 1:  Platform payout → Bank aggregator record (amount ±$1, date ±3d)
 * Pass 1b: 3-way absorption (third source matches existing group)
 * Pass 2:  Secondary bank ↔ Primary bank (exact amount, date ±3d)
 *
 * All marked duplicates get `duplicateOfId` pointing to the canonical record
 * and `reconciliationStatus = 'reconciled'`.
 *
 * The primary bank aggregator is auto-detected as the source with the most
 * expense records. Secondary sources are those with >80% overlap.
 */

import { prisma } from "../../db/prisma";

const AMOUNT_TOLERANCE = 1.0; // $1
const DATE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

interface DedupResult {
  pass1Matched: number;
  pass1bAbsorbed: number;
  pass2Matched: number;
  totalDuplicatesMarked: number;
}

interface MinimalTx {
  id: string;
  date: Date;
  amount: number;
  type: string;
  sourcePlatform: string;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Detect the primary bank aggregator (source with most expense records).
 */
async function detectPrimarySource(): Promise<string> {
  const result = await prisma.$queryRawUnsafe<{ source: string }[]>(`
    SELECT source_platform as source
    FROM transactions
    WHERE type = 'expense'
    GROUP BY source_platform
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `);
  return result[0]?.source || "rocketmoney";
}

/**
 * Detect secondary bank sources (>80% overlap with primary).
 */
async function detectSecondarySources(primary: string): Promise<string[]> {
  const sources = await prisma.$queryRawUnsafe<{ source: string }[]>(`
    SELECT DISTINCT source_platform as source
    FROM transactions
    WHERE source_platform != '${primary}'
  `);

  const secondary: string[] = [];
  for (const { source } of sources) {
    const overlap = await prisma.$queryRawUnsafe<{ pct: number }[]>(`
      SELECT ROUND(
        100.0 * (
          SELECT COUNT(*) FROM transactions s
          WHERE s.source_platform = '${source}'
            AND EXISTS (
              SELECT 1 FROM transactions p
              WHERE p.source_platform = '${primary}'
                AND ABS(ABS(p.amount) - ABS(s.amount)) < 1.0
                AND ABS(julianday(p.date) - julianday(s.date)) < 3
            )
        ) / NULLIF((SELECT COUNT(*) FROM transactions WHERE source_platform = '${source}'), 0)
      , 1) as pct
    `);
    if (Number(overlap[0]?.pct || 0) > 80) {
      secondary.push(source);
    }
  }
  return secondary;
}

/**
 * Detect platform API sources (sources that have payout records but aren't
 * primary or secondary bank feeds).
 */
async function detectPlatformSources(
  primary: string,
  secondary: string[]
): Promise<string[]> {
  const excluded = [primary, ...secondary];
  const placeholders = excluded.map(() => "?").join(",");
  const sources = await prisma.$queryRawUnsafe<{ source: string }[]>(
    `SELECT DISTINCT source_platform as source
     FROM transactions
     WHERE source_platform NOT IN (${placeholders})
       AND type = 'payout'`,
    ...excluded
  );
  return sources.map((s) => s.source);
}

/**
 * Run cross-source dedup. Marks duplicates with `duplicateOfId`.
 * Idempotent — call `resetDuplicateLinks()` first for a clean re-run.
 */
export async function runCrossSourceDedup(): Promise<DedupResult> {
  const primarySource = await detectPrimarySource();
  const secondarySources = await detectSecondarySources(primarySource);
  const platformSources = await detectPlatformSources(
    primarySource,
    secondarySources
  );

  const result: DedupResult = {
    pass1Matched: 0,
    pass1bAbsorbed: 0,
    pass2Matched: 0,
    totalDuplicatesMarked: 0,
  };

  // Load all transactions into memory for efficient matching
  const allTx = await prisma.transaction.findMany({
    where: { duplicateOfId: null },
    select: {
      id: true,
      date: true,
      amount: true,
      type: true,
      sourcePlatform: true,
    },
    orderBy: { date: "asc" },
  });

  const used = new Set<string>(); // IDs already assigned to a group

  // ── Pass 1: Platform payout → Bank aggregator record ──────────────
  const platformPayouts = allTx.filter(
    (t) =>
      t.type === "payout" &&
      platformSources.includes(t.sourcePlatform)
  );
  const bankRecords = allTx.filter(
    (t) =>
      [primarySource, ...secondarySources].includes(t.sourcePlatform) &&
      (t.type === "income" || t.type === "payout")
  );

  // Build candidate pairs scored by match quality
  const candidates: {
    payout: MinimalTx;
    bankRecord: MinimalTx;
    score: number;
  }[] = [];

  for (const payout of platformPayouts) {
    for (const bankRecord of bankRecords) {
      const amountDiff = Math.abs(
        Math.abs(payout.amount) - Math.abs(bankRecord.amount)
      );
      const dateDiff = daysBetween(payout.date, bankRecord.date);

      if (amountDiff <= AMOUNT_TOLERANCE && dateDiff <= 3.0) {
        // Lower score = better match
        // Primary source preferred over secondary
        const sourcePenalty =
          bankRecord.sourcePlatform === primarySource ? 0 : 10;
        const score = amountDiff * 100 + sourcePenalty + dateDiff;
        candidates.push({ payout, bankRecord, score });
      }
    }
  }

  // Greedy matching — best score first, each record used once
  candidates.sort((a, b) => a.score - b.score);

  const groups: { primaryId: string; duplicateIds: string[] }[] = [];

  for (const { payout, bankRecord } of candidates) {
    if (used.has(payout.id) || used.has(bankRecord.id)) continue;

    used.add(payout.id);
    used.add(bankRecord.id);

    groups.push({
      primaryId: bankRecord.id, // bank record is canonical
      duplicateIds: [payout.id],
    });
    result.pass1Matched++;
  }

  // ── Pass 1b: Absorb 3-way duplicates ────────────────────────────
  for (const t of allTx) {
    if (used.has(t.id)) continue;
    if (
      ![primarySource, ...secondarySources].includes(t.sourcePlatform)
    )
      continue;
    if (t.type !== "income" && t.type !== "payout") continue;

    for (const group of groups) {
      // Find the primary record
      const primary = allTx.find((r) => r.id === group.primaryId);
      if (!primary) continue;
      if (t.sourcePlatform === primary.sourcePlatform) continue;

      const amountDiff = Math.abs(
        Math.abs(t.amount) - Math.abs(primary.amount)
      );
      const dateDiff = daysBetween(t.date, primary.date);

      if (amountDiff <= AMOUNT_TOLERANCE && dateDiff <= 3.0) {
        group.duplicateIds.push(t.id);
        used.add(t.id);
        result.pass1bAbsorbed++;
        break;
      }
    }
  }

  // ── Pass 2: Secondary bank ↔ Primary bank duplicates ────────────
  if (secondarySources.length > 0) {
    const ungroupedBank = allTx.filter(
      (t) =>
        !used.has(t.id) &&
        [primarySource, ...secondarySources].includes(t.sourcePlatform)
    );

    // Group by amount for efficient matching
    const byAmount = new Map<number, MinimalTx[]>();
    for (const t of ungroupedBank) {
      const key = Math.round(t.amount * 100); // cent-level
      if (!byAmount.has(key)) byAmount.set(key, []);
      byAmount.get(key)!.push(t);
    }

    for (const [, sameAmount] of byAmount) {
      if (sameAmount.length < 2) continue;

      for (let i = 0; i < sameAmount.length; i++) {
        for (let j = i + 1; j < sameAmount.length; j++) {
          const a = sameAmount[i];
          const b = sameAmount[j];

          if (used.has(a.id) || used.has(b.id)) continue;
          if (a.sourcePlatform === b.sourcePlatform) continue;
          if (daysBetween(a.date, b.date) > 3.0) continue;

          // Primary source record is canonical
          const primary =
            a.sourcePlatform === primarySource ? a : b;
          const duplicate = primary === a ? b : a;

          used.add(primary.id);
          used.add(duplicate.id);

          groups.push({
            primaryId: primary.id,
            duplicateIds: [duplicate.id],
          });
          result.pass2Matched++;
        }
      }
    }
  }

  // ── Write to DB ─────────────────────────────────────────────────
  // Batch updates for performance
  const BATCH_SIZE = 500;
  const allUpdates: { id: string; duplicateOfId: string }[] = [];

  for (const group of groups) {
    for (const dupId of group.duplicateIds) {
      allUpdates.push({ id: dupId, duplicateOfId: group.primaryId });
    }
  }

  result.totalDuplicatesMarked = allUpdates.length;

  for (let i = 0; i < allUpdates.length; i += BATCH_SIZE) {
    const batch = allUpdates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.transaction.update({
          where: { id: u.id },
          data: {
            duplicateOfId: u.duplicateOfId,
            reconciliationStatus: "reconciled",
          },
        })
      )
    );
  }

  return result;
}

/**
 * Clear all `duplicateOfId` links for a clean re-run.
 */
export async function resetDuplicateLinks(): Promise<number> {
  const result = await prisma.transaction.updateMany({
    where: { duplicateOfId: { not: null } },
    data: {
      duplicateOfId: null,
      reconciliationStatus: "unreconciled",
    },
  });
  return result.count;
}
