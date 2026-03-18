/**
 * Bank Activity Grouping — Merges duplicate records from multiple sources.
 *
 * The Bank Activity page shows transactions from bank platforms (Chase, Rocket Money)
 * AND payout records from sales platforms (Square, DoorDash, etc.). The same real-world
 * deposit often appears from multiple sources, inflating totals.
 *
 * This module groups duplicates at the display level (no data deletion) using three passes:
 *   Pass 1:  Match platform payouts with bank deposits (date ±3 days, amount ±$1)
 *   Pass 1b: Absorb 3-way duplicates — e.g. a DoorDash payout appears from DoorDash API,
 *            Rocket Money, AND Chase. Pass 1 pairs two; this pass adds the third.
 *   Pass 2:  Match Chase ↔ Rocket Money duplicates (date ±3 days, exact amount)
 *
 * Date tolerance is 3 days because Chase stores dates at T05:00:00Z (midnight EST)
 * while Rocket Money uses T00:00:00Z, and posting dates can differ by 1-2 calendar days.
 *
 * See docs/TRANSACTIONS.md for full architecture documentation.
 */

const PAYOUT_PLATFORMS = new Set(["square", "doordash", "ubereats", "grubhub"]);
const BANK_PLATFORMS = new Set(["rocketmoney", "chase"]);

/** Minimal transaction shape needed for grouping */
export interface GroupableTransaction {
  id: string;
  date: string;
  amount: number;
  type: string;
  sourcePlatform: string;
  [key: string]: unknown;
}

export interface GroupedTransaction<T extends GroupableTransaction = GroupableTransaction> {
  primary: T;
  duplicates: T[];
  groupReason?: "payout_match" | "cross_source_duplicate";
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

/**
 * Group duplicate bank activity transactions.
 *
 * @param transactions - Enriched transaction array (any page/subset)
 * @returns Grouped transactions with primary + duplicates per group
 */
export function groupBankActivity<T extends GroupableTransaction>(
  transactions: T[]
): GroupedTransaction<T>[] {
  const used = new Set<string>(); // IDs already assigned to a group

  // ── Pass 1: Platform payout ↔ bank record matching ─────────────────
  //
  // A Square payout (type='payout', source='square') should merge with
  // its corresponding bank record. Bank records can be either:
  //   - type='income' from Chase (e.g., "Square Inc" deposit)
  //   - type='payout' from Rocket Money (e.g., "ORIG CO NAME:Square Inc")
  // The bank record is primary (has richer account info).

  const platformPayouts = transactions.filter(
    (t) => t.type === "payout" && PAYOUT_PLATFORMS.has(t.sourcePlatform)
  );
  const bankDeposits = transactions.filter(
    (t) => BANK_PLATFORMS.has(t.sourcePlatform) &&
           (t.type === "income" || t.type === "payout")
  );

  // Build candidate pairs scored by match quality.
  // Rocket Money is the source of truth, so RM bank records get priority
  // over Chase when both could match the same platform payout.
  const candidates: { payout: T; bankRecord: T; score: number }[] = [];

  for (const payout of platformPayouts) {
    for (const bankRecord of bankDeposits) {
      const amountDiff = Math.abs(Math.abs(payout.amount) - Math.abs(bankRecord.amount));
      const dateDiff = daysBetween(payout.date, bankRecord.date);

      if (amountDiff <= 1.0 && dateDiff <= 3.0) {
        // Lower score = better match. Amount diff weighted most, then
        // source priority (RM preferred over Chase), then date diff.
        const sourcePenalty = bankRecord.sourcePlatform === "rocketmoney" ? 0 : 10;
        const score = amountDiff * 100 + sourcePenalty + dateDiff;
        candidates.push({ payout, bankRecord, score });
      }
    }
  }

  // Sort by best match first, then greedily assign (each record matches once)
  candidates.sort((a, b) => a.score - b.score);

  const groups: GroupedTransaction<T>[] = [];

  for (const { payout, bankRecord } of candidates) {
    if (used.has(payout.id) || used.has(bankRecord.id)) continue;

    used.add(payout.id);
    used.add(bankRecord.id);

    groups.push({
      primary: bankRecord,  // bank record is primary (RM preferred)
      duplicates: [payout], // platform payout attached as child
      groupReason: "payout_match",
    });
  }

  // ── Pass 1b: Absorb 3-way duplicates ──────────────────────────────────
  //
  // A DoorDash payout can appear from 3 sources: DoorDash API, Rocket Money,
  // AND Chase. Pass 1 pairs two of them (e.g. RM payout ↔ DoorDash payout),
  // leaving the Chase income record orphaned. This pass finds ungrouped bank
  // records that match an existing group's primary by amount + date, and
  // absorbs them as additional duplicates.

  const groupByPrimaryId = new Map(groups.map((g) => [g.primary.id, g]));

  for (const t of transactions) {
    if (used.has(t.id)) continue;
    if (!BANK_PLATFORMS.has(t.sourcePlatform)) continue;
    if (t.type !== "income" && t.type !== "payout") continue;

    // Check against each existing Pass 1 group's primary
    for (const group of groups) {
      if (group.groupReason !== "payout_match") continue;
      if (t.sourcePlatform === group.primary.sourcePlatform) continue;

      const amountDiff = Math.abs(Math.abs(t.amount) - Math.abs(group.primary.amount));
      const dateDiff = daysBetween(t.date, group.primary.date);

      if (amountDiff <= 1.0 && dateDiff <= 3.0) {
        group.duplicates.push(t);
        used.add(t.id);
        break;
      }
    }
  }

  // ── Pass 2: Chase ↔ Rocket Money same-transaction duplicates ─────────
  //
  // The same bank transaction can appear from both Chase and Rocket Money
  // with different descriptions. Match by exact amount + date ±3 days.
  // Wider window needed because Chase uses T05:00Z dates (midnight EST)
  // and Rocket Money posting dates can lag 1-2 days.

  const ungroupedBank = transactions.filter(
    (t) => !used.has(t.id) && BANK_PLATFORMS.has(t.sourcePlatform)
  );

  // Group by amount for efficient matching
  const byAmount = new Map<number, T[]>();
  for (const t of ungroupedBank) {
    const key = Math.round(t.amount * 100); // cent-level grouping
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key)!.push(t);
  }

  for (const [, sameAmount] of byAmount) {
    if (sameAmount.length < 2) continue;

    // Try to find cross-source pairs
    for (let i = 0; i < sameAmount.length; i++) {
      for (let j = i + 1; j < sameAmount.length; j++) {
        const a = sameAmount[i];
        const b = sameAmount[j];

        if (used.has(a.id) || used.has(b.id)) continue;
        if (a.sourcePlatform === b.sourcePlatform) continue;
        if (daysBetween(a.date, b.date) > 3.0) continue;

        // Prefer Rocket Money as primary (richer metadata)
        const primary = a.sourcePlatform === "rocketmoney" ? a : b;
        const duplicate = primary === a ? b : a;

        used.add(primary.id);
        used.add(duplicate.id);

        groups.push({
          primary,
          duplicates: [duplicate],
          groupReason: "cross_source_duplicate",
        });
      }
    }
  }

  // ── Add ungrouped records as solo entries ─────────────────────────────
  //
  // Rocket Money is the source of truth for bank activity. Chase records
  // that couldn't be matched to an RM record are excluded — they would be
  // redundant since RM has comprehensive coverage. Platform payouts and
  // RM records always appear.

  for (const t of transactions) {
    if (!used.has(t.id)) {
      // Skip standalone Chase records — RM is the source of truth
      if (t.sourcePlatform === "chase") continue;
      groups.push({ primary: t, duplicates: [] });
    }
  }

  // Preserve original sort order (by primary's position in input)
  const indexMap = new Map(transactions.map((t, i) => [t.id, i]));
  groups.sort((a, b) => (indexMap.get(a.primary.id) ?? 0) - (indexMap.get(b.primary.id) ?? 0));

  return groups;
}

/**
 * Compute deduped summary totals from grouped transactions.
 * Only counts the primary record in each group — duplicates are excluded.
 */
export function computeDedupedSummary<T extends GroupableTransaction>(
  groups: GroupedTransaction<T>[]
): { summary: Record<string, { count: number; total: number }>; mergedGroupCount: number } {
  const summary: Record<string, { count: number; total: number }> = {};
  let mergedGroupCount = 0;

  for (const group of groups) {
    const { type, amount } = group.primary;
    if (!summary[type]) summary[type] = { count: 0, total: 0 };
    summary[type].count += 1;
    summary[type].total += amount;

    if (group.duplicates.length > 0) mergedGroupCount++;
  }

  return { summary, mergedGroupCount };
}
