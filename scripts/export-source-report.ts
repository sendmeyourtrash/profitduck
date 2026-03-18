#!/usr/bin/env npx tsx
/**
 * Step 1: Export Source Diagnostics (Data-Driven)
 *
 * READ-ONLY report — no database modifications.
 *
 * Uses the raw `category` field from the bank aggregator (Rocket Money)
 * instead of hardcoded vendor-name patterns. This makes it generic
 * and usable for any business onboarded to the platform.
 *
 * Sections:
 *   1. Income — platform deposits (GROUP BY raw category on payouts)
 *   2. Expenses — by RM category (GROUP BY raw category on expenses)
 *   3. Internal Transfers — category LIKE 'transfer:%'
 *   4. Net Profit Summary
 *   5. Cross-Source Duplicate Analysis
 *   6. Cleanup Estimate
 *   7. Uncategorized / Review Items
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: `file:${process.cwd()}/dev.db` });
const prisma = new PrismaClient({ adapter });

// Detect the primary bank aggregator source (the one with the most expense records)
async function detectPrimarySource(): Promise<string> {
  const sources = await prisma.$queryRawUnsafe<{ source: string; cnt: number }[]>(`
    SELECT source_platform as source, COUNT(*) as cnt
    FROM transactions
    WHERE type = 'expense'
    GROUP BY source_platform
    ORDER BY cnt DESC
    LIMIT 1
  `);
  return sources[0]?.source || "rocketmoney";
}

// Detect secondary bank sources (same institution, different feed)
async function detectSecondarySources(primary: string): Promise<string[]> {
  const sources = await prisma.$queryRawUnsafe<{ source: string }[]>(`
    SELECT DISTINCT source_platform as source
    FROM transactions
    WHERE source_platform != '${primary}'
      AND type IN ('income', 'expense', 'payout')
    ORDER BY source_platform
  `);
  // Secondary = sources that overlap heavily with primary (bank feeds, not platform APIs)
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
    const pct = Number(overlap[0]?.pct || 0);
    if (pct > 80) secondary.push(source); // >80% overlap = duplicate bank feed
  }
  return secondary;
}

// Detect platform API sources (sources that contribute payout records)
async function detectPlatformSources(primary: string, secondary: string[]): Promise<string[]> {
  const excluded = [primary, ...secondary].map((s) => `'${s}'`).join(",");
  const sources = await prisma.$queryRawUnsafe<{ source: string }[]>(`
    SELECT DISTINCT source_platform as source
    FROM transactions
    WHERE source_platform NOT IN (${excluded})
      AND type = 'payout'
    ORDER BY source_platform
  `);
  return sources.map((s) => s.source);
}

function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function run() {
  const primarySource = await detectPrimarySource();
  const secondarySources = await detectSecondarySources(primarySource);
  const platformSources = await detectPlatformSources(primarySource, secondarySources);

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║            DATA SOURCE DIAGNOSTIC REPORT                    ║");
  console.log(`║            Source of Truth: ${titleCase(primarySource).padEnd(31)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log(`  Detected sources:`);
  console.log(`    Primary (bank aggregator):  ${primarySource}`);
  if (secondarySources.length > 0) {
    console.log(`    Secondary (duplicate feeds): ${secondarySources.join(", ")}`);
  }
  if (platformSources.length > 0) {
    console.log(`    Platform APIs:              ${platformSources.join(", ")}`);
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: INCOME (by raw category from bank aggregator payouts)
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ 1. INCOME — Platform Deposits ═══\n");
  console.log("  Revenue deposited into the bank (from bank aggregator payout records).\n");

  const incomeByCategory = await prisma.$queryRawUnsafe<
    { category: string; cnt: number; total: number }[]
  >(`
    SELECT
      COALESCE(category, '(uncategorized)') as category,
      COUNT(*) as cnt,
      ROUND(SUM(amount), 2) as total
    FROM transactions
    WHERE source_platform = '${primarySource}' AND type = 'payout'
    GROUP BY category
    ORDER BY total DESC
  `);

  let totalIncome = 0;
  let totalIncomeCount = 0;

  console.log(`  Source               Records     Total Deposited`);
  console.log(`  ─────────────────────────────────────────────────`);
  for (const row of incomeByCategory) {
    const label = titleCase(row.category);
    console.log(`  ${label.padEnd(20)} ${String(row.cnt).padStart(6)}      ${fmt(Number(row.total)).padStart(14)}`);
    totalIncome += Number(row.total);
    totalIncomeCount += Number(row.cnt);
  }
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  TOTAL INCOME       ${String(totalIncomeCount).padStart(6)}      ${fmt(totalIncome).padStart(14)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: EXPENSES (by raw category, excluding transfers)
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ 2. EXPENSES — Money Out ═══\n");
  console.log("  Business expenses (excluding internal transfers).\n");

  const expensesByCategory = await prisma.$queryRawUnsafe<
    { category: string; cnt: number; total: number }[]
  >(`
    SELECT
      COALESCE(category, '(uncategorized)') as category,
      COUNT(*) as cnt,
      ROUND(SUM(ABS(amount)), 2) as total
    FROM transactions
    WHERE source_platform = '${primarySource}' AND type = 'expense'
      AND (category IS NULL OR category NOT LIKE 'transfer:%')
      AND amount > 0
    GROUP BY category
    ORDER BY total DESC
  `);

  let expenseTotal = 0;
  let expenseCount = 0;

  console.log(`  Category                   Records     Total Spent`);
  console.log(`  ──────────────────────────────────────────────────────`);
  for (const row of expensesByCategory) {
    const label = titleCase(row.category);
    expenseTotal += Number(row.total);
    expenseCount += Number(row.cnt);
    console.log(
      `  ${label.padEnd(27)} ${String(row.cnt).padStart(5)}      ${fmt(Number(row.total)).padStart(14)}`
    );
  }
  console.log(`  ──────────────────────────────────────────────────────`);
  console.log(`  TOTAL EXPENSES             ${String(expenseCount).padStart(5)}      ${fmt(expenseTotal).padStart(14)}`);
  console.log();

  // Show top vendors in each category for review
  console.log(`  Top vendors per category (for review):`);
  for (const cat of expensesByCategory.slice(0, 6)) {
    const topVendors = await prisma.$queryRawUnsafe<{ desc: string; cnt: number; total: number }[]>(`
      SELECT substr(description, 1, 40) as desc, COUNT(*) as cnt, ROUND(SUM(amount), 2) as total
      FROM transactions
      WHERE source_platform = '${primarySource}' AND type = 'expense'
        AND amount > 0
        AND COALESCE(category, '(uncategorized)') = '${cat.category.replace(/'/g, "''")}'
      GROUP BY desc
      ORDER BY total DESC
      LIMIT 3
    `);
    console.log(`\n    ${titleCase(cat.category)}:`);
    for (const v of topVendors) {
      console.log(`      ${fmt(v.total).padStart(12)} | ${v.desc} (×${v.cnt})`);
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: INTERNAL TRANSFERS
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n═══ 3. INTERNAL TRANSFERS — Should Cancel Out ═══\n");
  console.log("  Transfers between accounts (CC payments, funding, etc.).");
  console.log("  These are not business income/expenses.\n");

  const transfers = await prisma.$queryRawUnsafe<
    { category: string; type: string; cnt: number; total: number }[]
  >(`
    SELECT
      COALESCE(category, '(uncategorized)') as category,
      type,
      COUNT(*) as cnt,
      ROUND(SUM(amount), 2) as total
    FROM transactions
    WHERE source_platform = '${primarySource}'
      AND (category LIKE 'transfer:%' OR type = 'income')
    GROUP BY category, type
    ORDER BY category, type
  `);

  console.log(`  Category / Type                Records     Amount`);
  console.log(`  ─────────────────────────────────────────────────────`);
  for (const row of transfers) {
    const label = `${titleCase(row.category)} (${row.type})`;
    console.log(`  ${label.padEnd(35)} ${String(row.cnt).padStart(5)}      ${fmt(Number(row.total)).padStart(14)}`);
  }

  // Also show negative expenses (CC payment outflows)
  const negExpenses = await prisma.$queryRawUnsafe<{ cnt: number; total: number }[]>(`
    SELECT COUNT(*) as cnt, ROUND(SUM(amount), 2) as total
    FROM transactions
    WHERE source_platform = '${primarySource}' AND type = 'expense' AND amount < 0
  `);
  if (Number(negExpenses[0]?.cnt || 0) > 0) {
    console.log(`  Negative expenses (outflows)     ${String(negExpenses[0].cnt).padStart(5)}      ${fmt(Number(negExpenses[0].total)).padStart(14)}`);
  }
  console.log();

  // Also show transfer:funding separately since user flagged it
  const fundingExpenses = await prisma.$queryRawUnsafe<{ cnt: number; total: number }[]>(`
    SELECT COUNT(*) as cnt, ROUND(SUM(amount), 2) as total
    FROM transactions
    WHERE source_platform = '${primarySource}' AND type = 'expense'
      AND category = 'transfer:funding' AND amount > 0
  `);
  if (Number(fundingExpenses[0]?.cnt || 0) > 0) {
    console.log(`  ⚠ Note: ${fundingExpenses[0].cnt} funding transactions (${fmt(Number(fundingExpenses[0].total))}) are in expenses with positive amounts.`);
    console.log(`    These are categorized as "transfer:funding" by the bank aggregator.`);
    console.log(`    They are currently INCLUDED in the expense total above.`);
    console.log();
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: NET PROFIT SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ 4. NET PROFIT SUMMARY ═══\n");

  console.log(`  Total Income (platform deposits):      ${fmt(totalIncome).padStart(14)}`);
  console.log(`  Total Expenses (excl. transfers):      ${fmt(-expenseTotal).padStart(14)}`);
  console.log(`  ──────────────────────────────────────────────────`);
  console.log(`  NET PROFIT:                            ${fmt(totalIncome - expenseTotal).padStart(14)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: CROSS-SOURCE DUPLICATE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ 5. CROSS-SOURCE DUPLICATE ANALYSIS ═══\n");

  // Secondary source overlap
  for (const secondary of secondarySources) {
    const secCount = await prisma.$queryRawUnsafe<{ cnt: number }[]>(`
      SELECT COUNT(*) as cnt FROM transactions WHERE source_platform = '${secondary}'
    `);
    const secMatched = await prisma.$queryRawUnsafe<{ cnt: number }[]>(`
      SELECT COUNT(*) as cnt FROM transactions s
      WHERE s.source_platform = '${secondary}'
        AND EXISTS (
          SELECT 1 FROM transactions p
          WHERE p.source_platform = '${primarySource}'
            AND ABS(ABS(p.amount) - ABS(s.amount)) < 1.0
            AND ABS(julianday(p.date) - julianday(s.date)) < 3
        )
    `);
    const total = Number(secCount[0]?.cnt || 0);
    const matched = Number(secMatched[0]?.cnt || 0);
    const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
    console.log(`  ${titleCase(secondary)} ↔ ${titleCase(primarySource)}:`);
    console.log(`    ${matched.toLocaleString()} / ${total.toLocaleString()} records match (${pct}% are duplicates)\n`);
  }

  // Platform API overlap with bank records
  console.log(`  Platform API ↔ Bank Records:`);
  let totalPayoutDups = 0;
  for (const platform of platformSources) {
    const result = await prisma.$queryRawUnsafe<{ total: number; matched: number }[]>(`
      SELECT
        (SELECT COUNT(*) FROM transactions WHERE source_platform = '${platform}' AND type = 'payout') as total,
        (SELECT COUNT(*) FROM transactions p
         WHERE p.source_platform = '${platform}' AND p.type = 'payout'
           AND EXISTS (
             SELECT 1 FROM transactions b
             WHERE b.source_platform IN ('${primarySource}', ${secondarySources.map((s) => `'${s}'`).join(",") || "''"})
               AND (b.type = 'income' OR b.type = 'payout')
               AND ABS(ABS(b.amount) - ABS(p.amount)) < 1.0
               AND ABS(julianday(b.date) - julianday(p.date)) < 3
           )) as matched
    `);
    const total = Number(result[0]?.total || 0);
    const matched = Number(result[0]?.matched || 0);
    totalPayoutDups += matched;
    if (total > 0) {
      console.log(`    ${platform.padEnd(12)} ${matched} / ${total} payouts are duplicates of bank records`);
    }
  }

  // 3-way duplicates
  if (secondarySources.length > 0 && platformSources.length > 0) {
    const platList = platformSources.map((s) => `'${s}'`).join(",");
    const secList = secondarySources.map((s) => `'${s}'`).join(",");
    const threeWay = await prisma.$queryRawUnsafe<{ cnt: number }[]>(`
      SELECT COUNT(*) as cnt FROM transactions p
      WHERE p.source_platform IN (${platList})
        AND p.type = 'payout'
        AND EXISTS (
          SELECT 1 FROM transactions rm
          WHERE rm.source_platform = '${primarySource}'
            AND (rm.type = 'income' OR rm.type = 'payout')
            AND ABS(ABS(rm.amount) - ABS(p.amount)) < 1.0
            AND ABS(julianday(rm.date) - julianday(p.date)) < 3
        )
        AND EXISTS (
          SELECT 1 FROM transactions ch
          WHERE ch.source_platform IN (${secList})
            AND ABS(ABS(ch.amount) - ABS(p.amount)) < 1.0
            AND ABS(julianday(ch.date) - julianday(p.date)) < 3
        )
    `);
    console.log(`\n    3-way duplicates (in all 3 source types): ${threeWay[0]?.cnt}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 6: CLEANUP ESTIMATE
  // ═══════════════════════════════════════════════════════════════════
  console.log();
  console.log("\n═══ 6. CLEANUP ESTIMATE ═══\n");

  const totalRecords = await prisma.transaction.count();
  let totalDups = totalPayoutDups;
  for (const secondary of secondarySources) {
    const secCount = await prisma.$queryRawUnsafe<{ cnt: number }[]>(`
      SELECT COUNT(*) as cnt FROM transactions WHERE source_platform = '${secondary}'
    `);
    totalDups += Number(secCount[0]?.cnt || 0);
  }

  console.log(`  Total records in database:          ${totalRecords.toLocaleString()}`);
  for (const secondary of secondarySources) {
    const secCount = await prisma.$queryRawUnsafe<{ cnt: number }[]>(`
      SELECT COUNT(*) as cnt FROM transactions WHERE source_platform = '${secondary}'
    `);
    console.log(`  ${titleCase(secondary)} duplicates of ${titleCase(primarySource)}:${String(`-${Number(secCount[0]?.cnt || 0).toLocaleString()}`).padStart(16)}`);
  }
  console.log(`  Platform payouts matching bank:     -${totalPayoutDups.toLocaleString()}`);
  console.log(`  ──────────────────────────────────────────────────`);
  console.log(`  Clean canonical records:           ~${(totalRecords - totalDups).toLocaleString()}`);
  console.log(`  Duplicates to mark:                ~${totalDups.toLocaleString()}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 7: UNCATEGORIZED / REVIEW ITEMS
  // ═══════════════════════════════════════════════════════════════════
  console.log("═══ 7. ITEMS NEEDING REVIEW ═══\n");

  // Uncategorized expenses
  const uncategorized = await prisma.$queryRawUnsafe<{ desc: string; amount: number; date: string }[]>(`
    SELECT substr(description, 1, 50) as desc, amount, substr(date, 1, 10) as date
    FROM transactions
    WHERE source_platform = '${primarySource}' AND type = 'expense'
      AND amount > 0 AND category IS NULL
    ORDER BY ABS(amount) DESC
    LIMIT 20
  `);

  if (uncategorized.length > 0) {
    console.log(`  Uncategorized expenses (${uncategorized.length} shown):`);
    for (const u of uncategorized) {
      console.log(`    ${u.date} | ${fmt(u.amount).padStart(12)} | ${u.desc}`);
    }
    console.log();
  } else {
    console.log(`  ✓ All expenses have categories from the bank aggregator.\n`);
  }

  // Transfer-category expenses that are positive (may need reclassification)
  const transferExpenses = await prisma.$queryRawUnsafe<
    { category: string; cnt: number; total: number }[]
  >(`
    SELECT category, COUNT(*) as cnt, ROUND(SUM(amount), 2) as total
    FROM transactions
    WHERE source_platform = '${primarySource}' AND type = 'expense'
      AND category LIKE 'transfer:%' AND amount > 0
    GROUP BY category
    ORDER BY total DESC
  `);

  if (transferExpenses.length > 0) {
    console.log(`  Transfer-type expenses with positive amounts (may need review):`);
    for (const t of transferExpenses) {
      console.log(`    ${titleCase(t.category).padEnd(35)} ${String(t.cnt).padStart(5)} records   ${fmt(Number(t.total)).padStart(12)}`);
    }
    console.log(`    → These are marked as transfers but show up as positive expenses.`);
    console.log(`    → Should these be excluded from expense totals? (e.g., "transfer:funding" = funding cost)`);
    console.log();
  }

  // Unmatched income records (CC payments without matching expense)
  const unmatchedIncome = await prisma.$queryRawUnsafe<{ date: string; amount: number; desc: string }[]>(`
    SELECT substr(t.date, 1, 10) as date, t.amount, substr(t.description, 1, 50) as desc
    FROM transactions t
    WHERE t.source_platform = '${primarySource}' AND t.type = 'income'
      AND NOT EXISTS (
        SELECT 1 FROM transactions e
        WHERE e.source_platform = '${primarySource}' AND e.type = 'expense'
          AND e.amount < 0
          AND ABS(ABS(e.amount) - ABS(t.amount)) < 0.01
          AND ABS(julianday(e.date) - julianday(t.date)) < 3
      )
    ORDER BY t.date
  `);

  if (unmatchedIncome.length > 0) {
    console.log(`  Unmatched income records (${unmatchedIncome.length} — no matching negative expense):`);
    for (const u of unmatchedIncome) {
      console.log(`    ${u.date} | ${fmt(u.amount).padStart(12)} | ${u.desc}`);
    }
    console.log(`    → These are likely CC auto-payments without a matching expense-side record.`);
    console.log();
  }

  console.log("═══ REPORT COMPLETE ═══\n");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
