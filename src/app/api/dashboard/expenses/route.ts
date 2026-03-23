/**
 * Expenses Dashboard API — Source of truth: bank.db (rocketmoney) + sales.db (orders).
 *
 * Bank expenses come from rocketmoney table (positive amounts, excluding payout categories).
 * Platform fees come from sales.db orders table.
 * Vendor names are resolved via vendor alias system.
 * Categories use the RM category field, with ignored categories excluded.
 */
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { resolveVendorFromRecord, resolveVendorCategory } from "@/lib/db/bank-db";
import { getAllCategoryIgnores } from "@/lib/db/config-db";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  return new Database(path.join(DB_DIR, name), { readonly: true });
}

const PAYOUT_CATEGORIES = [
  "Square", "Square ", "GrubHub", "DOORDASH", "Uber Eats", "Credit Card Payment",
];

const TRANSFER_CATEGORIES = ["Credit Card Payment"];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");

  const bankDb = openDb("bank.db");
  const salesDb = openDb("sales.db");

  try {
    // ---------- Date range ----------
    let startDate: string;
    let endDate: string | undefined;

    if (rawStart) {
      startDate = rawStart;
      if (rawEnd) endDate = rawEnd;
    } else {
      // All time — find earliest
      const earliest = bankDb.prepare(
        `SELECT MIN(date) as d FROM rocketmoney WHERE CAST(amount AS REAL) > 0`
      ).get() as { d: string | null };
      startDate = earliest?.d || "2020-01-01";
    }

    // ---------- Ignored categories ----------
    const ignoredCats = getAllCategoryIgnores();
    const ignoredCatNames = new Set(ignoredCats.map((ic) => ic.category_name.toLowerCase()));

    // ---------- Build payout exclusion ----------
    const payoutPlaceholders = PAYOUT_CATEGORIES.map(() => "?").join(",");

    // ---------- Fetch all expense records ----------
    const dateClause = endDate
      ? `AND date >= ? AND date <= ?`
      : `AND date >= ?`;
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

    // ---------- Process records: resolve vendors, filter ignored ----------
    interface ProcessedExpense {
      id: number;
      date: string;
      vendorName: string;
      category: string;
      resolvedCategory: string | null;
      amount: number;
      accountName: string;
      note: string;
    }

    const processed: ProcessedExpense[] = [];

    for (const r of allExpenses) {
      const amt = parseFloat(r.amount) || 0;
      if (amt <= 0) continue;

      const vendorName = resolveVendorFromRecord(r.name || "", r.custom_name || "", r.description || "");
      const resolvedCategory = resolveVendorCategory(vendorName);
      const categoryName = resolvedCategory || r.category || "Uncategorized";

      // Skip ignored categories
      if (ignoredCatNames.has(categoryName.toLowerCase())) continue;

      processed.push({
        id: r.id,
        date: r.date,
        vendorName,
        category: categoryName,
        resolvedCategory,
        amount: amt,
        accountName: r.account_name || "",
        note: r.note || "",
      });
    }

    // ---------- Expenses by vendor ----------
    const vendorMap = new Map<string, { total: number; count: number }>();
    for (const e of processed) {
      const existing = vendorMap.get(e.vendorName);
      if (existing) {
        existing.total += e.amount;
        existing.count++;
      } else {
        vendorMap.set(e.vendorName, { total: e.amount, count: 1 });
      }
    }
    const expensesByVendor = [...vendorMap.entries()]
      .map(([name, v]) => ({
        vendorId: name,
        vendorName: name,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    // ---------- Expenses by category ----------
    const categoryMap = new Map<string, { total: number; count: number }>();
    for (const e of processed) {
      const existing = categoryMap.get(e.category);
      if (existing) {
        existing.total += e.amount;
        existing.count++;
      } else {
        categoryMap.set(e.category, { total: e.amount, count: 1 });
      }
    }
    const expensesByCategory = [...categoryMap.entries()]
      .map(([cat, v]) => ({
        category: cat,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total);

    // ---------- Daily expense trend ----------
    const dailyMap = new Map<string, number>();
    for (const e of processed) {
      const d = e.date;
      dailyMap.set(d, (dailyMap.get(d) || 0) + e.amount);
    }
    const dailyExpenses = [...dailyMap.entries()]
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ---------- Expenses by payment method (account_name) ----------
    const pmMap = new Map<string, { total: number; count: number }>();
    for (const e of processed) {
      const pm = e.accountName || "Unknown";
      const existing = pmMap.get(pm);
      if (existing) {
        existing.total += e.amount;
        existing.count++;
      } else {
        pmMap.set(pm, { total: e.amount, count: 1 });
      }
    }
    const expensesByPaymentMethod = [...pmMap.entries()]
      .map(([pm, v]) => ({
        paymentMethod: pm,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total);

    // ---------- Platform fees from sales.db ----------
    const feeDateClause = endDate
      ? `AND date >= ? AND date <= ?`
      : `AND date >= ?`;
    const feeDateParams = endDate ? [startDate, endDate] : [startDate];

    const platformFees = salesDb.prepare(
      `SELECT platform,
        ROUND(SUM(ABS(commission_fee)), 2) as commission,
        ROUND(SUM(ABS(processing_fee)), 2) as service,
        ROUND(SUM(ABS(delivery_fee)), 2) as delivery,
        ROUND(SUM(ABS(marketing_fee)), 2) as marketing,
        0 as customer
       FROM orders
       WHERE order_status = 'completed'
       ${feeDateClause}
       GROUP BY platform
       ORDER BY SUM(ABS(fees_total)) DESC`
    ).all(...feeDateParams) as {
      platform: string; commission: number; service: number;
      delivery: number; marketing: number; customer: number;
    }[];

    // ---------- Transfers summary ----------
    const transferPlaceholders = TRANSFER_CATEGORIES.map(() => "?").join(",");
    const transferDateClause = endDate
      ? `AND date >= ? AND date <= ?`
      : `AND date >= ?`;

    const transferExpenses = bankDb.prepare(
      `SELECT category, ROUND(SUM(ABS(CAST(amount AS REAL))), 2) as total, COUNT(*) as cnt
       FROM rocketmoney
       WHERE category IN (${transferPlaceholders})
       ${transferDateClause}
       GROUP BY category
       ORDER BY total DESC`
    ).all(...TRANSFER_CATEGORIES, ...dateParams) as {
      category: string; total: number; cnt: number;
    }[];

    return NextResponse.json({
      expensesByVendor,
      expensesByCategory,
      dailyExpenses,
      expensesByPaymentMethod,
      feesByPlatform: platformFees
        .map((f) => ({
          platform: f.platform,
          fees:
            (f.commission || 0) +
            (f.service || 0) +
            (f.delivery || 0) +
            (f.marketing || 0) +
            (f.customer || 0),
          breakdown: {
            commission: f.commission || 0,
            service: f.service || 0,
            delivery: f.delivery || 0,
            marketing: f.marketing || 0,
            customer: f.customer || 0,
          },
        }))
        .filter((f) => f.fees > 0)
        .sort((a, b) => b.fees - a.fees),
      transfers: transferExpenses.map((t) => ({
        category: t.category,
        total: Number(t.total),
        count: Number(t.cnt),
      })),
    });
  } finally {
    bankDb.close();
    salesDb.close();
  }
}
