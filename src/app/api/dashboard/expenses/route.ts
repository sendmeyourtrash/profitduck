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

function computePriorPeriod(startDate: string, endDate: string | undefined): { prevStart: string; prevEnd: string } {
  const start = new Date(startDate + "T00:00:00");
  const end = endDate ? new Date(endDate + "T00:00:00") : new Date();
  const spanMs = end.getTime() - start.getTime();
  const spanDays = Math.max(1, Math.round(spanMs / 86_400_000));
  const prevEnd = new Date(start.getTime() - 86_400_000); // day before start
  const prevStart = new Date(prevEnd.getTime() - spanDays * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
}

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

    // ---------- Prior period ----------
    const { prevStart, prevEnd } = computePriorPeriod(startDate, endDate);

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

    // ---------- Prior period expenses ----------
    const prevAllExpenses = bankDb.prepare(
      `SELECT id, date, name, custom_name, description, category, amount, account_name, note
       FROM rocketmoney
       WHERE CAST(amount AS REAL) > 0
       AND category NOT IN (${payoutPlaceholders})
       AND category IS NOT NULL
       AND date >= ? AND date <= ?
       ORDER BY date DESC`
    ).all(...PAYOUT_CATEGORIES, prevStart, prevEnd) as typeof allExpenses;

    const prevProcessed: ProcessedExpense[] = [];
    for (const r of prevAllExpenses) {
      const amt = parseFloat(r.amount) || 0;
      if (amt <= 0) continue;
      const vendorName = resolveVendorFromRecord(r.name || "", r.custom_name || "", r.description || "");
      const resolvedCategory = resolveVendorCategory(vendorName);
      const categoryName = resolvedCategory || r.category || "Uncategorized";
      if (ignoredCatNames.has(categoryName.toLowerCase())) continue;
      prevProcessed.push({ id: r.id, date: r.date, vendorName, category: categoryName, resolvedCategory, amount: amt, accountName: r.account_name || "", note: r.note || "" });
    }

    const prevTotalExpenses = prevProcessed.reduce((s, e) => s + e.amount, 0);

    // Prior period by category
    const prevCategoryMap = new Map<string, number>();
    for (const e of prevProcessed) {
      prevCategoryMap.set(e.category, (prevCategoryMap.get(e.category) || 0) + e.amount);
    }

    // Prior period by vendor
    const prevVendorMap = new Map<string, number>();
    for (const e of prevProcessed) {
      prevVendorMap.set(e.vendorName, (prevVendorMap.get(e.vendorName) || 0) + e.amount);
    }

    // Prior period platform fees
    const prevPlatformFees = salesDb.prepare(
      `SELECT ROUND(SUM(ABS(fees_total)), 2) as total
       FROM orders WHERE order_status = 'completed'
       AND date >= ? AND date <= ?`
    ).get(prevStart, prevEnd) as { total: number };
    const prevTotalFees = prevPlatformFees.total || 0;

    // ---------- Biggest movers (categories with largest % change) ----------
    const movers: { category: string; current: number; previous: number; change: number; direction: "up" | "down" }[] = [];
    for (const [cat, v] of categoryMap.entries()) {
      const prev = prevCategoryMap.get(cat) || 0;
      if (prev > 50) { // only flag categories with meaningful prior spend
        const change = Math.round(((v.total - prev) / prev) * 1000) / 10;
        if (Math.abs(change) > 15) {
          movers.push({
            category: cat,
            current: Math.round(v.total * 100) / 100,
            previous: Math.round(prev * 100) / 100,
            change,
            direction: change > 0 ? "up" : "down",
          });
        }
      }
    }
    // Also check for categories that disappeared
    for (const [cat, prev] of prevCategoryMap.entries()) {
      if (!categoryMap.has(cat) && prev > 100) {
        movers.push({ category: cat, current: 0, previous: Math.round(prev * 100) / 100, change: -100, direction: "down" });
      }
    }
    movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

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

    // ---------- Compute totals early ----------
    const totalExpenses = processed.reduce((s, e) => s + e.amount, 0);

    // ---------- Recurring vs One-time split ----------
    const RECURRING_CATEGORIES = new Set([
      "rent", "rent & utilities", "insurance", "payroll & salary", "salary",
      "software & tech", "security", "permits & licenses",
    ]);
    let recurringTotal = 0, recurringCount = 0;
    let oneTimeTotal = 0, oneTimeCount = 0;
    const recurringByCategory = new Map<string, { total: number; count: number }>();
    const oneTimeByCategory = new Map<string, { total: number; count: number }>();

    for (const e of processed) {
      const isRecurring = RECURRING_CATEGORIES.has(e.category.toLowerCase());
      if (isRecurring) {
        recurringTotal += e.amount;
        recurringCount++;
        const existing = recurringByCategory.get(e.category);
        if (existing) { existing.total += e.amount; existing.count++; }
        else recurringByCategory.set(e.category, { total: e.amount, count: 1 });
      } else {
        oneTimeTotal += e.amount;
        oneTimeCount++;
        const existing = oneTimeByCategory.get(e.category);
        if (existing) { existing.total += e.amount; existing.count++; }
        else oneTimeByCategory.set(e.category, { total: e.amount, count: 1 });
      }
    }

    // ---------- Top single transactions ----------
    const topTransactions = [...processed]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        date: e.date,
        vendorName: e.vendorName,
        category: e.category,
        amount: Math.round(e.amount * 100) / 100,
        note: e.note || null,
      }));

    // ---------- Monthly budget progress ----------
    // Compute current month stats for budget tracking
    const now = new Date();
    const curMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    let curMonthSpend = 0;
    for (const e of processed) {
      if (e.date.startsWith(curMonthStr)) curMonthSpend += e.amount;
    }

    // Calculate monthly average from all data for budget baseline
    const monthSet = new Set<string>();
    for (const e of processed) monthSet.add(e.date.substring(0, 7));
    const monthCount = monthSet.size || 1;
    const monthlyAvg = totalExpenses / monthCount;

    // Projected month-end spend (pace-based)
    const projectedMonthEnd = dayOfMonth > 0 ? (curMonthSpend / dayOfMonth) * daysInMonth : 0;

    // ---------- Compute summary changes ----------
    const curTotalFees = platformFees.reduce((s, f) => (f.commission || 0) + (f.service || 0) + (f.delivery || 0) + (f.marketing || 0) + (f.customer || 0) + s, 0);

    const changePct = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur > 0 ? 100 : 0);

    return NextResponse.json({
      // Summary with prior period comparison
      summary: {
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        prevTotalExpenses: Math.round(prevTotalExpenses * 100) / 100,
        expenseChange: changePct(totalExpenses, prevTotalExpenses),
        totalFees: Math.round(curTotalFees * 100) / 100,
        prevTotalFees: Math.round(prevTotalFees * 100) / 100,
        feesChange: changePct(curTotalFees, prevTotalFees),
        combinedCosts: Math.round((totalExpenses + curTotalFees) * 100) / 100,
        prevCombinedCosts: Math.round((prevTotalExpenses + prevTotalFees) * 100) / 100,
        combinedChange: changePct(totalExpenses + curTotalFees, prevTotalExpenses + prevTotalFees),
      },
      movers: movers.slice(0, 5),
      // Recurring vs one-time
      costSplit: {
        recurring: {
          total: Math.round(recurringTotal * 100) / 100,
          count: recurringCount,
          pct: totalExpenses > 0 ? Math.round((recurringTotal / totalExpenses) * 1000) / 10 : 0,
          categories: [...recurringByCategory.entries()]
            .map(([cat, v]) => ({ category: cat, total: Math.round(v.total * 100) / 100, count: v.count }))
            .sort((a, b) => b.total - a.total),
        },
        variable: {
          total: Math.round(oneTimeTotal * 100) / 100,
          count: oneTimeCount,
          pct: totalExpenses > 0 ? Math.round((oneTimeTotal / totalExpenses) * 1000) / 10 : 0,
          categories: [...oneTimeByCategory.entries()]
            .map(([cat, v]) => ({ category: cat, total: Math.round(v.total * 100) / 100, count: v.count }))
            .sort((a, b) => b.total - a.total),
        },
      },
      topTransactions,
      monthlyBudget: {
        currentMonth: curMonthStr,
        spent: Math.round(curMonthSpend * 100) / 100,
        monthlyAvg: Math.round(monthlyAvg * 100) / 100,
        projected: Math.round(projectedMonthEnd * 100) / 100,
        dayOfMonth,
        daysInMonth,
        paceVsAvg: monthlyAvg > 0 ? Math.round(((projectedMonthEnd - monthlyAvg) / monthlyAvg) * 1000) / 10 : 0,
      },
      expensesByVendor: expensesByVendor.map((v) => ({
        ...v,
        prevTotal: Math.round((prevVendorMap.get(v.vendorName) || 0) * 100) / 100,
        change: changePct(v.total, prevVendorMap.get(v.vendorName) || 0),
      })),
      expensesByCategory: expensesByCategory.map((c) => ({
        ...c,
        prevTotal: Math.round((prevCategoryMap.get(c.category) || 0) * 100) / 100,
        change: changePct(c.total, prevCategoryMap.get(c.category) || 0),
      })),
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
