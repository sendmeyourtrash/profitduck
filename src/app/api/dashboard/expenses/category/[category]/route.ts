/**
 * Category detail API — Source of truth: bank.db (rocketmoney).
 * Drills down into a specific expense category showing monthly trends,
 * vendor breakdown, stats, and paginated transaction list.
 */
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { resolveVendorFromRecord, resolveVendorCategory } from "@/lib/db/bank-db";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  return new Database(path.join(DB_DIR, name), { readonly: true });
}

const PAYOUT_CATEGORIES = [
  "Square", "Square ", "GrubHub", "DOORDASH", "Uber Eats", "Credit Card Payment",
];

function computePriorPeriod(startDate: string, endDate: string | undefined): { prevStart: string; prevEnd: string } {
  const start = new Date(startDate + "T00:00:00");
  const end = endDate ? new Date(endDate + "T00:00:00") : new Date();
  const spanMs = end.getTime() - start.getTime();
  const spanDays = Math.max(1, Math.round(spanMs / 86_400_000));
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - spanDays * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
}

interface ProcessedExpense {
  id: number;
  date: string;
  vendorName: string;
  category: string;
  amount: number;
  accountName: string;
  note: string;
}

function fetchAndResolve(
  bankDb: InstanceType<typeof Database>,
  payoutPlaceholders: string,
  dateClause: string,
  dateParams: string[]
): ProcessedExpense[] {
  const rows = bankDb.prepare(
    `SELECT id, date, name, custom_name, description, category, amount, account_name, note
     FROM rocketmoney
     WHERE CAST(amount AS REAL) > 0
     AND category NOT IN (${payoutPlaceholders})
     AND category IS NOT NULL
     ${dateClause}
     ORDER BY date DESC`
  ).all(...PAYOUT_CATEGORIES, ...dateParams) as {
    id: number; date: string; name: string; custom_name: string;
    description: string; category: string; amount: string;
    account_name: string; note: string;
  }[];

  const result: ProcessedExpense[] = [];
  for (const r of rows) {
    const amt = parseFloat(r.amount) || 0;
    if (amt <= 0) continue;
    const resolved = resolveVendorFromRecord(r.name || "", r.custom_name || "", r.description || "");
    const resolvedCategory = resolveVendorCategory(resolved);
    const categoryName = resolvedCategory || r.category || "Uncategorized";
    result.push({
      id: r.id, date: r.date, vendorName: resolved,
      category: categoryName, amount: amt,
      accountName: r.account_name || "", note: r.note || "",
    });
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;
  const decodedCategory = decodeURIComponent(category);
  const { searchParams } = new URL(request.url);
  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");
  const page = parseInt(searchParams.get("page") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");

  const bankDb = openDb("bank.db");

  try {
    let startDate: string;
    let endDate: string | undefined;

    if (rawStart) {
      startDate = rawStart;
      if (rawEnd) endDate = rawEnd;
    } else {
      const earliest = bankDb.prepare(
        `SELECT MIN(date) as d FROM rocketmoney WHERE CAST(amount AS REAL) > 0`
      ).get() as { d: string | null };
      startDate = earliest?.d || "2020-01-01";
    }

    const payoutPlaceholders = PAYOUT_CATEGORIES.map(() => "?").join(",");
    const dateClause = endDate ? `AND date >= ? AND date <= ?` : `AND date >= ?`;
    const dateParams = endDate ? [startDate, endDate] : [startDate];

    // Current period
    const allExpenses = fetchAndResolve(bankDb, payoutPlaceholders, dateClause, dateParams);
    const lowerTarget = decodedCategory.toLowerCase();
    const matching = allExpenses.filter((e) => e.category.toLowerCase() === lowerTarget);

    // Prior period
    const { prevStart, prevEnd } = computePriorPeriod(startDate, endDate);
    const prevExpenses = fetchAndResolve(bankDb, payoutPlaceholders, `AND date >= ? AND date <= ?`, [prevStart, prevEnd]);
    const prevMatching = prevExpenses.filter((e) => e.category.toLowerCase() === lowerTarget);

    const total = matching.reduce((s, e) => s + e.amount, 0);
    const count = matching.length;
    const average = count > 0 ? total / count : 0;
    const prevTotal = prevMatching.reduce((s, e) => s + e.amount, 0);
    const prevCount = prevMatching.length;

    const changePct = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur > 0 ? 100 : 0);

    if (count === 0) {
      return NextResponse.json({
        category: decodedCategory,
        total: 0, count: 0, average: 0, totalPages: 0,
        prevTotal: 0, prevCount: 0, change: 0,
        stats: { min: 0, max: 0, median: 0, average: 0 },
        frequency: null,
        monthlyTrend: [], vendorBreakdown: [], expenses: [],
      });
    }

    // ---------- Min / Max / Median ----------
    const amounts = matching.map((e) => e.amount).sort((a, b) => a - b);
    const min = amounts[0];
    const max = amounts[amounts.length - 1];
    const median = amounts.length % 2 === 0
      ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
      : amounts[Math.floor(amounts.length / 2)];

    // ---------- Frequency insight ----------
    let frequency: { label: string; avgDaysBetween: number } | null = null;
    if (matching.length >= 2) {
      const sortedDates = matching.map((e) => e.date).sort();
      const gaps: number[] = [];
      for (let i = 1; i < sortedDates.length; i++) {
        const d1 = new Date(sortedDates[i - 1] + "T00:00:00");
        const d2 = new Date(sortedDates[i] + "T00:00:00");
        gaps.push(Math.round((d2.getTime() - d1.getTime()) / 86_400_000));
      }
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      let label: string;
      if (avgGap <= 2) label = "Almost daily";
      else if (avgGap <= 5) label = `~${Math.round(avgGap)}x per week`;
      else if (avgGap <= 10) label = `Every ~${Math.round(avgGap)} days`;
      else if (avgGap <= 20) label = `~${Math.round(30 / avgGap)}x per month`;
      else if (avgGap <= 45) label = "About monthly";
      else if (avgGap <= 100) label = `Every ~${Math.round(avgGap / 30)} months`;
      else label = `Every ~${Math.round(avgGap)} days`;
      frequency = { label, avgDaysBetween: Math.round(avgGap * 10) / 10 };
    }

    // ---------- Monthly trend ----------
    const monthMap = new Map<string, number>();
    for (const e of matching) {
      const month = e.date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + e.amount);
    }
    const monthlyTrend = [...monthMap.entries()]
      .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // ---------- Vendor breakdown ----------
    const vendorMap = new Map<string, { total: number; count: number }>();
    for (const e of matching) {
      const existing = vendorMap.get(e.vendorName);
      if (existing) { existing.total += e.amount; existing.count++; }
      else vendorMap.set(e.vendorName, { total: e.amount, count: 1 });
    }
    const vendorBreakdown = [...vendorMap.entries()]
      .map(([name, v]) => ({ vendorName: name, total: Math.round(v.total * 100) / 100, count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // ---------- Paginated expenses ----------
    const offset = page * limit;
    const paginatedExpenses = matching.slice(offset, offset + limit);
    const totalPages = Math.ceil(count / limit);

    return NextResponse.json({
      category: decodedCategory,
      total: Math.round(total * 100) / 100,
      count,
      average: Math.round(average * 100) / 100,
      prevTotal: Math.round(prevTotal * 100) / 100,
      prevCount,
      change: changePct(total, prevTotal),
      stats: {
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100,
        median: Math.round(median * 100) / 100,
        average: Math.round(average * 100) / 100,
      },
      frequency,
      totalPages,
      monthlyTrend,
      vendorBreakdown,
      expenses: paginatedExpenses.map((e) => ({
        id: e.id, date: e.date, amount: e.amount,
        vendorName: e.vendorName, notes: e.note || null,
        paymentMethod: e.accountName || null,
      })),
    });
  } finally {
    bankDb.close();
  }
}
