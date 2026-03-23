/**
 * Category detail API — Source of truth: bank.db (rocketmoney).
 * Drills down into a specific expense category showing monthly trends,
 * vendor breakdown, and paginated transaction list.
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
    // ---------- Date range ----------
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

    // ---------- Fetch all expense records ----------
    const payoutPlaceholders = PAYOUT_CATEGORIES.map(() => "?").join(",");
    const dateClause = endDate ? `AND date >= ? AND date <= ?` : `AND date >= ?`;
    const dateParams = endDate ? [startDate, endDate] : [startDate];

    const allExpenses = bankDb.prepare(
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

    // ---------- Filter to matching category ----------
    interface ProcessedExpense {
      id: number;
      date: string;
      vendorName: string;
      category: string;
      amount: number;
      accountName: string;
      note: string;
    }

    const matching: ProcessedExpense[] = [];
    const lowerTarget = decodedCategory.toLowerCase();

    for (const r of allExpenses) {
      const amt = parseFloat(r.amount) || 0;
      if (amt <= 0) continue;

      const vendorName = resolveVendorFromRecord(r.name || "", r.custom_name || "", r.description || "");
      const resolvedCategory = resolveVendorCategory(vendorName);
      const categoryName = resolvedCategory || r.category || "Uncategorized";

      if (categoryName.toLowerCase() !== lowerTarget) continue;

      matching.push({
        id: r.id,
        date: r.date,
        vendorName,
        category: categoryName,
        amount: amt,
        accountName: r.account_name || "",
        note: r.note || "",
      });
    }

    // ---------- Aggregations ----------
    const total = matching.reduce((s, e) => s + e.amount, 0);
    const count = matching.length;
    const average = count > 0 ? total / count : 0;

    // ---------- Monthly trend ----------
    const monthMap = new Map<string, number>();
    for (const e of matching) {
      const month = e.date.substring(0, 7); // yyyy-MM
      monthMap.set(month, (monthMap.get(month) || 0) + e.amount);
    }
    const monthlyTrend = [...monthMap.entries()]
      .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // ---------- Vendor breakdown ----------
    const vendorMap = new Map<string, { total: number; count: number }>();
    for (const e of matching) {
      const existing = vendorMap.get(e.vendorName);
      if (existing) {
        existing.total += e.amount;
        existing.count++;
      } else {
        vendorMap.set(e.vendorName, { total: e.amount, count: 1 });
      }
    }
    const vendorBreakdown = [...vendorMap.entries()]
      .map(([name, v]) => ({
        vendorName: name,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
      }))
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
      totalPages,
      monthlyTrend,
      vendorBreakdown,
      expenses: paginatedExpenses.map((e) => ({
        id: e.id,
        date: e.date,
        amount: e.amount,
        vendorName: e.vendorName,
        notes: e.note || null,
        paymentMethod: e.accountName || null,
      })),
    });
  } finally {
    bankDb.close();
  }
}
