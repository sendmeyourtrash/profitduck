/**
 * Dashboard Overview API
 *
 * Revenue & fees from sales.db (orders table)
 * Expenses from bank.db (rocketmoney table — excludes platform payouts & CC payments)
 */
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
  format,
} from "date-fns";

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  return new Database(path.join(DB_DIR, name), { readonly: true });
}

export async function GET() {
  const salesDb = openDb("sales.db");
  const bankDb = openDb("bank.db");

  try {
    const now = new Date();
    const todayStr = format(startOfDay(now), "yyyy-MM-dd");
    const todayEndStr = format(endOfDay(now), "yyyy-MM-dd");
    const weekStr = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const monthStr = format(startOfMonth(now), "yyyy-MM-dd");

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

    const todayRevenue = sumRevenue(todayStr, todayEndStr);
    const weekRevenue = sumRevenue(weekStr, todayEndStr);
    const monthRevenue = sumRevenue(monthStr, todayEndStr);
    const totalRevenue = sumRevenue();

    const todayFees = sumFees(todayStr, todayEndStr);
    const weekFees = sumFees(weekStr, todayEndStr);
    const monthFees = sumFees(monthStr, todayEndStr);
    const totalFees = sumFees();

    const todayExpenses = sumExpenses(todayStr, todayEndStr);
    const weekExpenses = sumExpenses(weekStr, todayEndStr);
    const monthExpenses = sumExpenses(monthStr, todayEndStr);
    const totalExpenses = sumExpenses();

    // Platform breakdown from sales.db
    const platformBreakdown = salesDb.prepare(`
      SELECT platform, ROUND(SUM(gross_sales), 2) as revenue, COUNT(*) as orders
      FROM orders WHERE order_status = 'completed'
      GROUP BY platform ORDER BY revenue DESC
    `).all() as { platform: string; revenue: number; orders: number }[];

    // CC transfers from bank.db
    const transfers = bankDb.prepare(`
      SELECT COUNT(*) as count, ROUND(SUM(ABS(CAST(amount AS REAL))), 2) as total
      FROM rocketmoney WHERE category = 'Credit Card Payment'
    `).get() as { count: number; total: number };

    // Expense category breakdown from bank.db
    const expensesByCategory = bankDb.prepare(`
      SELECT category, ROUND(SUM(CAST(amount AS REAL)), 2) as total, COUNT(*) as cnt
      FROM rocketmoney
      WHERE CAST(amount AS REAL) > 0
        AND category NOT IN (${excludeList})
        AND category IS NOT NULL
      GROUP BY category ORDER BY total DESC LIMIT 10
    `).all(...PAYOUT_CATEGORIES) as { category: string; total: number; cnt: number }[];

    // Recent transactions from bank.db
    const recentTransactions = bankDb.prepare(`
      SELECT date, name, custom_name, amount, category, account_type, account_name
      FROM rocketmoney
      WHERE category NOT IN ('Credit Card Payment')
      ORDER BY date DESC LIMIT 10
    `).all() as { date: string; name: string; custom_name: string; amount: string; category: string; account_type: string; account_name: string }[];

    return NextResponse.json({
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
        netProfitSinceFirstSale: totalRevenue - totalFees - totalExpenses,
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
      recentTransactions: recentTransactions.map((t) => ({
        date: t.date,
        description: t.custom_name || t.name,
        amount: parseFloat(t.amount),
        category: t.category,
        type: parseFloat(t.amount) < 0 ? "payout" : "expense",
        sourcePlatform: "rocketmoney",
        accountType: t.account_type,
        accountName: t.account_name,
      })),
    });
  } finally {
    salesDb.close();
    bankDb.close();
  }
}
