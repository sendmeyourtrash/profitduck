/**
 * Dashboard Overview API
 *
 * Revenue & fees from sales.db (orders table)
 * Expenses from bank.db (rocketmoney table — excludes platform payouts & CC payments)
 *
 * Accepts optional startDate/endDate query params for date filtering.
 * When provided, period stats (today/week/month) are replaced with the filtered range.
 */
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
  format,
} from "date-fns";
import { resolveVendorFromRecord, resolveVendorCategory } from "@/lib/db/bank-db";
import { getAllCategoryIgnores } from "@/lib/db/config-db";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  return new Database(path.join(DB_DIR, name), { readonly: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const salesDb = openDb("sales.db");
  const bankDb = openDb("bank.db");

  try {
    const now = new Date();
    const todayStr = format(startOfDay(now), "yyyy-MM-dd");
    const todayEndStr = format(endOfDay(now), "yyyy-MM-dd");
    const weekStr = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const monthStr = format(startOfMonth(now), "yyyy-MM-dd");

    // Get ignored categories
    const ignoredCats = getAllCategoryIgnores();
    const ignoredCatNames = new Set(ignoredCats.map((ic) => ic.category_name.toLowerCase()));

    // Revenue from sales.db — gross sales across all platforms
    const sumRevenue = (start?: string, end?: string) => {
      const conds = ["order_status = 'completed'"];
      const params: string[] = [];
      if (start) { conds.push("date >= ?"); params.push(start); }
      if (end) { conds.push("date <= ?"); params.push(end); }
      const r = salesDb.prepare(`SELECT ROUND(SUM(gross_sales), 2) as total FROM orders WHERE ${conds.join(" AND ")}`).get(...params) as { total: number };
      return r.total || 0;
    };

    // Fees from sales.db
    const sumFees = (start?: string, end?: string) => {
      const conds = ["order_status = 'completed'"];
      const params: string[] = [];
      if (start) { conds.push("date >= ?"); params.push(start); }
      if (end) { conds.push("date <= ?"); params.push(end); }
      const r = salesDb.prepare(`SELECT ROUND(SUM(fees_total), 2) as fees, ROUND(SUM(marketing_total), 2) as mktg FROM orders WHERE ${conds.join(" AND ")}`).get(...params) as { fees: number; mktg: number };
      return Math.abs(r.fees || 0) + Math.abs(r.mktg || 0);
    };

    // Expenses from bank.db — RM records that are NOT platform payouts or CC payments
    const PAYOUT_CATEGORIES = ["Square", "Square ", "GrubHub", "DOORDASH", "Uber Eats", "Credit Card Payment"];
    const excludeList = PAYOUT_CATEGORIES.map(() => "?").join(",");

    const sumExpenses = (start?: string, end?: string) => {
      const conds = [
        "CAST(amount AS REAL) > 0",
        `category NOT IN (${excludeList})`,
        "category IS NOT NULL",
      ];
      const params: string[] = [...PAYOUT_CATEGORIES];
      if (start) { conds.push("date >= ?"); params.push(start); }
      if (end) { conds.push("date <= ?"); params.push(end); }
      const r = bankDb.prepare(`SELECT ROUND(SUM(CAST(amount AS REAL)), 2) as total FROM rocketmoney WHERE ${conds.join(" AND ")}`).get(...params) as { total: number };
      return r.total || 0;
    };

    // Build period stats
    const hasDateRange = startDate && endDate;

    const periodRevenue = hasDateRange ? sumRevenue(startDate, endDate) : 0;
    const periodFees = hasDateRange ? sumFees(startDate, endDate) : 0;
    const periodExpenses = hasDateRange ? sumExpenses(startDate, endDate) : 0;

    const todayRevenue = sumRevenue(todayStr, todayEndStr);
    const weekRevenue = sumRevenue(weekStr, todayEndStr);
    const monthRevenue = sumRevenue(monthStr, todayEndStr);
    const totalRevenue = hasDateRange ? sumRevenue(startDate, endDate) : sumRevenue();

    const todayFees = sumFees(todayStr, todayEndStr);
    const weekFees = sumFees(weekStr, todayEndStr);
    const monthFees = sumFees(monthStr, todayEndStr);
    const totalFees = hasDateRange ? sumFees(startDate, endDate) : sumFees();

    const todayExpenses = sumExpenses(todayStr, todayEndStr);
    const weekExpenses = sumExpenses(weekStr, todayEndStr);
    const monthExpenses = sumExpenses(monthStr, todayEndStr);
    const totalExpenses = hasDateRange ? sumExpenses(startDate, endDate) : sumExpenses();

    // Platform breakdown from sales.db
    const platformConds = ["order_status = 'completed'"];
    const platformParams: string[] = [];
    if (hasDateRange) {
      platformConds.push("date >= ?", "date <= ?");
      platformParams.push(startDate, endDate);
    }
    const platformBreakdown = salesDb.prepare(`
      SELECT platform, ROUND(SUM(gross_sales), 2) as revenue, COUNT(*) as orders
      FROM orders WHERE ${platformConds.join(" AND ")}
      GROUP BY platform ORDER BY revenue DESC
    `).all(...platformParams) as { platform: string; revenue: number; orders: number }[];

    // CC transfers from bank.db
    const transferConds = ["category = 'Credit Card Payment'"];
    const transferParams: string[] = [];
    if (hasDateRange) {
      transferConds.push("date >= ?", "date <= ?");
      transferParams.push(startDate, endDate);
    }
    const transfers = bankDb.prepare(`
      SELECT COUNT(*) as count, ROUND(SUM(ABS(CAST(amount AS REAL))), 2) as total
      FROM rocketmoney WHERE ${transferConds.join(" AND ")}
    `).get(...transferParams) as { count: number; total: number };

    // Expense category breakdown from bank.db — with vendor alias resolution
    const expConds = [
      "CAST(amount AS REAL) > 0",
      `category NOT IN (${excludeList})`,
      "category IS NOT NULL",
    ];
    const expParams: string[] = [...PAYOUT_CATEGORIES];
    if (hasDateRange) {
      expConds.push("date >= ?", "date <= ?");
      expParams.push(startDate, endDate);
    }
    const rawExpenses = bankDb.prepare(`
      SELECT category, ROUND(SUM(CAST(amount AS REAL)), 2) as total, COUNT(*) as cnt
      FROM rocketmoney
      WHERE ${expConds.join(" AND ")}
      GROUP BY category ORDER BY total DESC LIMIT 10
    `).all(...expParams) as { category: string; total: number; cnt: number }[];

    // Filter out ignored categories from expense breakdown
    const expensesByCategory = rawExpenses.filter(
      (e) => !ignoredCatNames.has(e.category.toLowerCase())
    );

    // Recent transactions from bank.db — with vendor alias resolution
    const recentConds = ["category NOT IN ('Credit Card Payment')"];
    const recentParams: string[] = [];
    if (hasDateRange) {
      recentConds.push("date >= ?", "date <= ?");
      recentParams.push(startDate, endDate);
    }
    const recentTransactions = bankDb.prepare(`
      SELECT date, name, custom_name, description, amount, category, account_type, account_name
      FROM rocketmoney
      WHERE ${recentConds.join(" AND ")}
      ORDER BY date DESC LIMIT 10
    `).all(...recentParams) as { date: string; name: string; custom_name: string; description: string; amount: string; category: string; account_type: string; account_name: string }[];

    // ── NEW METRICS ──────────────────────────────────────────────────

    // WoW / MoM change %
    const subDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() - n); return r; };
    const lastWeekStart = format(startOfWeek(subDays(now, 7), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const lastWeekEnd = format(subDays(startOfWeek(now, { weekStartsOn: 1 }), 1), "yyyy-MM-dd");
    const lastMonthStart = format(new Date(now.getFullYear(), now.getMonth() - 1, 1), "yyyy-MM-dd");
    const lastMonthEnd = format(new Date(now.getFullYear(), now.getMonth(), 0), "yyyy-MM-dd");

    const lastWeekRevenue = sumRevenue(lastWeekStart, lastWeekEnd);
    const lastMonthRevenue = sumRevenue(lastMonthStart, lastMonthEnd);

    const pctChange = (cur: number, prev: number) =>
      prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;

    const weekChange = { value: pctChange(weekRevenue, lastWeekRevenue), label: "vs last week" };
    const monthChange = { value: pctChange(monthRevenue, lastMonthRevenue), label: "vs last month" };

    // Yesterday comparison
    const yesterdayStr = format(subDays(now, 1), "yyyy-MM-dd");
    const yesterdayRevenue = sumRevenue(yesterdayStr, yesterdayStr);
    const todayChange = { value: pctChange(todayRevenue, yesterdayRevenue), label: "vs yesterday" };

    // Daily averages
    const avgQuery = hasDateRange
      ? salesDb.prepare(`SELECT COUNT(DISTINCT date) as days, COUNT(*) as orders, ROUND(SUM(gross_sales), 2) as revenue FROM orders WHERE order_status='completed' AND date >= ? AND date <= ?`).get(startDate, endDate)
      : salesDb.prepare(`SELECT COUNT(DISTINCT date) as days, COUNT(*) as orders, ROUND(SUM(gross_sales), 2) as revenue FROM orders WHERE order_status='completed'`).get();
    const avgData = avgQuery as { days: number; orders: number; revenue: number };
    const dailyAvg = {
      revenue: avgData.days > 0 ? Math.round((avgData.revenue / avgData.days) * 100) / 100 : 0,
      orders: avgData.days > 0 ? Math.round((avgData.orders / avgData.days) * 10) / 10 : 0,
      orderValue: avgData.orders > 0 ? Math.round((avgData.revenue / avgData.orders) * 100) / 100 : 0,
    };

    // Profit margin & expense ratio
    const profitMargin = totalRevenue > 0
      ? Math.round(((totalRevenue - totalFees - totalExpenses) / totalRevenue) * 1000) / 10
      : 0;
    const expenseRatio = totalRevenue > 0
      ? Math.round(((totalFees + totalExpenses) / totalRevenue) * 1000) / 10
      : 0;

    // Cash flow from bank.db
    const cashFlowConds: string[] = [];
    const cashFlowParams: string[] = [];
    if (hasDateRange) {
      cashFlowConds.push("date >= ?", "date <= ?");
      cashFlowParams.push(startDate, endDate);
    }
    const cashFlowWhere = cashFlowConds.length > 0 ? `WHERE ${cashFlowConds.join(" AND ")}` : "";
    const cashFlowRow = bankDb.prepare(`
      SELECT
        ROUND(SUM(CASE WHEN CAST(amount AS REAL) < 0 THEN ABS(CAST(amount AS REAL)) ELSE 0 END), 2) as deposits,
        ROUND(SUM(CASE WHEN CAST(amount AS REAL) > 0 THEN CAST(amount AS REAL) ELSE 0 END), 2) as outflows
      FROM rocketmoney ${cashFlowWhere}
    `).get(...cashFlowParams) as { deposits: number; outflows: number };
    const cashFlow = {
      deposits: cashFlowRow.deposits || 0,
      outflows: cashFlowRow.outflows || 0,
      net: (cashFlowRow.deposits || 0) - (cashFlowRow.outflows || 0),
    };

    // Busiest day of week
    const dowConds = ["order_status = 'completed'"];
    const dowParams: string[] = [];
    if (hasDateRange) {
      dowConds.push("date >= ?", "date <= ?");
      dowParams.push(startDate, endDate);
    }
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dowRows = salesDb.prepare(`
      SELECT CAST(strftime('%w', date) AS INTEGER) as dow, COUNT(*) as orders, ROUND(SUM(gross_sales), 2) as revenue
      FROM orders WHERE ${dowConds.join(" AND ")}
      GROUP BY dow ORDER BY dow
    `).all(...dowParams) as { dow: number; orders: number; revenue: number }[];

    const dayOfWeekRevenue = dayNames.map((day, i) => {
      const row = dowRows.find((r) => r.dow === i);
      return { day, orders: row?.orders || 0, revenue: row?.revenue || 0 };
    });

    // Top 5 selling items from order_items
    const itemConds = ["oi.event_type NOT IN ('discount', 'refund')", "o.order_status = 'completed'"];
    const itemParams: string[] = [];
    if (hasDateRange) {
      itemConds.push("o.date >= ?", "o.date <= ?");
      itemParams.push(startDate, endDate);
    }
    const topItems = salesDb.prepare(`
      SELECT oi.display_name as name, SUM(oi.qty) as qty, ROUND(SUM(oi.gross_sales), 2) as revenue
      FROM order_items oi JOIN orders o ON oi.order_id = o.order_id
      WHERE ${itemConds.join(" AND ")}
      GROUP BY oi.display_name ORDER BY revenue DESC LIMIT 5
    `).all(...itemParams) as { name: string; qty: number; revenue: number }[];

    return NextResponse.json({
      hasDateRange: !!hasDateRange,
      period: hasDateRange ? {
        revenue: periodRevenue,
        fees: periodFees,
        expenses: periodExpenses,
        netProfit: periodRevenue - periodFees - periodExpenses,
      } : null,
      today: {
        revenue: todayRevenue,
        fees: todayFees,
        expenses: todayExpenses,
        netProfit: todayRevenue - todayFees - todayExpenses,
      },
      week: {
        revenue: weekRevenue,
        fees: weekFees,
        expenses: weekExpenses,
        netProfit: weekRevenue - weekFees - weekExpenses,
      },
      month: {
        revenue: monthRevenue,
        fees: monthFees,
        expenses: monthExpenses,
        netProfit: monthRevenue - monthFees - monthExpenses,
      },
      total: {
        revenue: totalRevenue,
        fees: totalFees,
        expenses: totalExpenses,
        netProfit: totalRevenue - totalFees - totalExpenses,
      },
      platformBreakdown: platformBreakdown.map((p) => ({
        platform: p.platform,
        revenue: p.revenue,
        orders: p.orders,
      })),
      transfers: {
        count: transfers.count || 0,
        total: transfers.total || 0,
        label: "CC Auto-Payments (ignored)",
      },
      expensesByCategory: expensesByCategory.map((e) => ({
        category: e.category,
        total: Number(e.total),
        count: Number(e.cnt),
      })),
      // New metrics
      todayChange,
      weekChange,
      monthChange,
      dailyAvg,
      profitMargin,
      expenseRatio,
      cashFlow,
      dayOfWeekRevenue,
      topItems: topItems.map((item) => ({
        name: item.name,
        qty: Number(item.qty),
        revenue: Number(item.revenue),
      })),
      recentTransactions: recentTransactions.map((t) => {
        const displayName = resolveVendorFromRecord(t.name, t.custom_name, t.description);
        return {
          date: t.date,
          description: displayName,
          amount: parseFloat(t.amount),
          category: resolveVendorCategory(displayName) || t.category,
          type: parseFloat(t.amount) < 0 ? "payout" : "expense",
          sourcePlatform: "rocketmoney",
          accountType: t.account_type,
          accountName: t.account_name,
        };
      }),
    });
  } finally {
    salesDb.close();
    bankDb.close();
  }
}
