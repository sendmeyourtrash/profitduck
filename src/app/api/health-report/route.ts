import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { getAllCategoryIgnores, countClosedDaysInRange, getClosedDays, getSettingValue } from "@/lib/db/config-db";
import { setConfiguredTimezone, toLocalDateStr } from "@/lib/utils/format";
import { linearRegression, computeSeasonalIndices } from "@/lib/utils/statistics";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfDay,
  endOfDay,
  subDays,
  startOfQuarter,
  endOfQuarter,
  subQuarters,
  subYears,
  getDaysInMonth,
  getDate,
  format,
} from "date-fns";
import { formatCurrency } from "@/lib/utils/format";
import { getSetting, SETTING_KEYS } from "@/lib/services/settings";

// ---------- Database helpers ----------

const DB_DIR = path.join(process.cwd(), "databases");

function openDb(name: string) {
  const db = new Database(path.join(DB_DIR, name));
  if (name === "bank.db") {
    const { ensureBankView } = require("@/lib/db/bank-db-setup");
    ensureBankView(db);
  }
  return db;
}

function dateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

const PAYOUT_CATEGORIES = ["Square", "Square ", "GrubHub", "DOORDASH", "Uber Eats", "Credit Card Payment"];

// ---------- Period configuration ----------

type Period = "1d" | "1w" | "1m" | "1q";
const VALID_PERIODS: Period[] = ["1d", "1w", "1m", "1q"];

interface PeriodDateRanges {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
  chartLookbackStart: Date;
  forecastDays: number;
  periodLabel: string;
  comparisonLabel: string;
}

function resolvePeriodDates(period: Period, now: Date, compare: "prior" | "yoy" = "prior"): PeriodDateRanges {
  switch (period) {
    case "1d": {
      const currentStart = startOfDay(now);
      const currentEnd = endOfDay(now);
      const previousStart = compare === "yoy" ? startOfDay(subYears(now, 1)) : startOfDay(subDays(now, 1));
      const previousEnd = compare === "yoy" ? endOfDay(subYears(now, 1)) : endOfDay(subDays(now, 1));
      const chartLookbackStart = currentStart;
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 1,
        periodLabel: "Today",
        comparisonLabel: compare === "yoy" ? "vs same day last year" : "vs yesterday",
      };
    }
    case "1w": {
      const currentStart = startOfDay(subDays(now, 6));
      const currentEnd = endOfDay(now);
      const previousStart = compare === "yoy" ? startOfDay(subYears(currentStart, 1)) : startOfDay(subDays(now, 13));
      const previousEnd = compare === "yoy" ? endOfDay(subYears(currentEnd, 1)) : endOfDay(subDays(now, 7));
      const chartLookbackStart = currentStart;
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 7,
        periodLabel: "This Week",
        comparisonLabel: compare === "yoy" ? "vs same week last year" : "vs prior week",
      };
    }
    case "1m": {
      const currentStart = startOfMonth(now);
      const currentEnd = endOfDay(now);
      const previousStart = compare === "yoy" ? startOfMonth(subYears(now, 1)) : startOfMonth(subMonths(now, 1));
      const previousEnd = compare === "yoy" ? endOfDay(subYears(now, 1)) : endOfMonth(subMonths(now, 1));
      const chartLookbackStart = currentStart;
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 30,
        periodLabel: now.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
        comparisonLabel: compare === "yoy" ? "vs same month last year" : "vs last month",
      };
    }
    case "1q": {
      const currentStart = startOfQuarter(now);
      const currentEnd = endOfDay(now);
      const previousStart = compare === "yoy" ? startOfQuarter(subYears(now, 1)) : startOfQuarter(subQuarters(now, 1));
      const previousEnd = compare === "yoy" ? endOfDay(subYears(now, 1)) : endOfQuarter(subQuarters(now, 1));
      const chartLookbackStart = currentStart;
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 90,
        periodLabel: `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`,
        comparisonLabel: compare === "yoy" ? "vs same quarter last year" : "vs last quarter",
      };
    }
  }
}

// ---------- Helpers ----------

function changeDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function confidenceLabel(r2: number): string {
  if (r2 >= 0.7) return `High (R\u00B2=${r2.toFixed(2)})`;
  if (r2 >= 0.4) return `Moderate (R\u00B2=${r2.toFixed(2)})`;
  return `Low (R\u00B2=${r2.toFixed(2)})`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Custom date range resolver ----------

function resolveCustomDates(
  rawStart: string,
  rawEnd: string,
  now: Date,
  compare: "prior" | "yoy" = "prior"
): PeriodDateRanges {
  // Use T12:00:00 to prevent UTC midnight → prior-day shift in local timezones
  let currentStart = rawStart ? startOfDay(new Date(rawStart + "T12:00:00")) : startOfDay(new Date(now.getTime() - 30 * 86_400_000));
  const currentEnd = rawEnd ? endOfDay(new Date(rawEnd + "T12:00:00")) : endOfDay(now);

  // Clamp: prevent absurd date ranges (e.g. year 0002 from incomplete date input)
  const maxLookbackMs = 5 * 365 * 86_400_000; // 5 years max
  if (currentEnd.getTime() - currentStart.getTime() > maxLookbackMs) {
    currentStart = startOfDay(new Date(currentEnd.getTime() - maxLookbackMs));
  }

  const spanMs = currentEnd.getTime() - currentStart.getTime();
  const spanDays = Math.max(1, Math.round(spanMs / 86_400_000));

  const previousStart = compare === "yoy"
    ? startOfDay(subYears(currentStart, 1))
    : startOfDay(subDays(currentStart, spanDays));
  const previousEnd = compare === "yoy"
    ? endOfDay(subYears(currentEnd, 1))
    : endOfDay(subDays(currentStart, 1));

  const chartLookbackStart = currentStart;

  let forecastDays: number;
  if (spanDays <= 1) forecastDays = 1;
  else if (spanDays <= 7) forecastDays = 7;
  else if (spanDays <= 30) forecastDays = 30;
  else forecastDays = 90;

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const periodLabel = rawStart
    ? `${fmt(currentStart)} — ${fmt(currentEnd)}`
    : "All Time";
  const comparisonLabel = compare === "yoy"
    ? "vs same period last year"
    : spanDays === 1
      ? "vs prior day"
      : spanDays <= 7
        ? `vs prior ${spanDays} days`
        : spanDays <= 31
          ? "vs prior period"
          : `vs prior ${spanDays} days`;

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    chartLookbackStart,
    forecastDays,
    periodLabel,
    comparisonLabel,
  };
}

// ---------- GET handler ----------

export async function GET(request: NextRequest) {
  // Load configured timezone for date formatting
  const tz = getSettingValue("timezone");
  if (tz) setConfiguredTimezone(tz);

  const { searchParams } = new URL(request.url);

  const now = new Date();
  let dates: PeriodDateRanges;

  const compare = searchParams.get("compare") === "yoy" ? "yoy" : "prior";

  const rawStart = searchParams.get("startDate");
  const rawEnd = searchParams.get("endDate");

  const salesDb = openDb("sales.db");
  const bankDb = openDb("bank.db");

  try {
    // ---------- Resolve period ----------

    if (rawStart || rawEnd) {
      dates = resolveCustomDates(rawStart || "", rawEnd || "", now, compare);
    } else {
      const rawPeriod = searchParams.get("period") ?? "1m";
      if (rawPeriod === "all") {
        const earliest = salesDb.prepare(
          `SELECT MIN(date) as d FROM orders WHERE order_status = 'completed'`
        ).get() as { d: string | null };
        const allStart = earliest?.d
          ? startOfDay(new Date(earliest.d + "T00:00:00"))
          : startOfDay(subDays(now, 365));
        dates = resolveCustomDates(
          dateStr(allStart),
          dateStr(now),
          now,
          compare
        );
      } else {
        const period: Period = VALID_PERIODS.includes(rawPeriod as Period)
          ? (rawPeriod as Period)
          : "1m";
        dates = resolvePeriodDates(period, now, compare);
      }
    }

    // ---------- Sales.db query helpers ----------

    const sumRevenue = (start: Date, end: Date): number => {
      const r = salesDb.prepare(
        `SELECT ROUND(SUM(gross_sales), 2) as total FROM orders
         WHERE order_status = 'completed' AND date >= ? AND date <= ?`
      ).get(dateStr(start), dateStr(end)) as { total: number };
      return r.total || 0;
    };

    const sumFees = (start: Date, end: Date): number => {
      const r = salesDb.prepare(
        `SELECT ROUND(SUM(ABS(fees_total)), 2) as fees, ROUND(SUM(ABS(marketing_total)), 2) as mktg
         FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?`
      ).get(dateStr(start), dateStr(end)) as { fees: number; mktg: number };
      return (r.fees || 0) + (r.mktg || 0);
    };

    // ---------- Bank.db expense helpers ----------

    const excludeList = PAYOUT_CATEGORIES.map(() => "?").join(",");

    const sumExpenses = (start: Date, end: Date): number => {
      const r = bankDb.prepare(
        `SELECT ROUND(SUM(CAST(amount AS REAL)), 2) as total FROM all_bank_transactions
         WHERE CAST(amount AS REAL) > 0 AND category NOT IN (${excludeList})
         AND category IS NOT NULL AND date >= ? AND date <= ?`
      ).get(...PAYOUT_CATEGORIES, dateStr(start), dateStr(end)) as { total: number };
      return r.total || 0;
    };

    // ---------- Get ignored categories ----------

    const ignoredCats = getAllCategoryIgnores();
    const ignoredCatNames = new Set(ignoredCats.map((ic) => ic.category_name.toLowerCase()));

    // ---------- Period KPIs ----------

    const curRevenue = sumRevenue(dates.currentStart, dates.currentEnd);
    const curFees = sumFees(dates.currentStart, dates.currentEnd);
    const curExpenses = sumExpenses(dates.currentStart, dates.currentEnd);
    const prevRevenue = sumRevenue(dates.previousStart, dates.previousEnd);
    const prevFees = sumFees(dates.previousStart, dates.previousEnd);
    const prevExpenses = sumExpenses(dates.previousStart, dates.previousEnd);

    // ---------- Daily series for chart ----------

    // Never show data before the user's selected start date
    const chartStart = dates.currentStart;

    // Closed day dates (needed before dailySeries to fill in $0 entries)
    const closedDayDates = getClosedDays().map((cd) => cd.date);

    const dailySeriesRaw = salesDb.prepare(
      `SELECT date, ROUND(SUM(gross_sales), 2) as total, COUNT(*) as count
       FROM orders WHERE order_status = 'completed' AND date >= ? AND date <= ?
       GROUP BY date ORDER BY date ASC`
    ).all(dateStr(chartStart), dateStr(dates.currentEnd)) as { date: string; total: number; count: number }[];

    // Fill in closed days as explicit $0 entries so they're visible on the chart
    const closedSet = new Set(closedDayDates);
    const salesByDate = new Map(dailySeriesRaw.map((d) => [d.date, d]));
    const dailySeries: { date: string; total: number; count: number }[] = [];
    const startMs = chartStart.getTime();
    const endMs = dates.currentEnd.getTime();
    for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
      const d = new Date(ms);
      const ds = toLocalDateStr(d);
      const existing = salesByDate.get(ds);
      if (existing) {
        dailySeries.push(existing);
      } else if (closedSet.has(ds)) {
        dailySeries.push({ date: ds, total: 0, count: 0 });
      }
      // Days with no sales and not marked closed are left out (no data)
    }

    // ---------- Platform aggregates ----------

    const platformAgg = salesDb.prepare(
      `SELECT platform,
        COUNT(*) as order_count,
        ROUND(SUM(gross_sales), 2) as subtotal,
        ROUND(SUM(ABS(fees_total)), 2) as total_fees,
        ROUND(SUM(net_sales), 2) as net_payout,
        ROUND(SUM(tip), 2) as tip
       FROM orders
       WHERE order_status = 'completed' AND date >= ? AND date <= ?
       GROUP BY platform ORDER BY subtotal DESC`
    ).all(dateStr(dates.currentStart), dateStr(dates.currentEnd)) as {
      platform: string; order_count: number; subtotal: number;
      total_fees: number; net_payout: number; tip: number;
    }[];

    // ---------- Expense by category ----------

    const rawExpensesByCategory = bankDb.prepare(
      `SELECT category, ROUND(SUM(CAST(amount AS REAL)), 2) as total, COUNT(*) as cnt
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND category NOT IN (${excludeList})
       AND category IS NOT NULL AND date >= ? AND date <= ?
       GROUP BY category ORDER BY total DESC LIMIT 10`
    ).all(...PAYOUT_CATEGORIES, dateStr(dates.currentStart), dateStr(dates.currentEnd)) as {
      category: string; total: number; cnt: number;
    }[];

    // Filter out ignored categories
    const expensesByCategory = rawExpensesByCategory.filter(
      (e) => !ignoredCatNames.has(e.category.toLowerCase())
    );

    const prevPeriodExpenseTotal = sumExpenses(dates.previousStart, dates.previousEnd);

    // Previous period expense breakdown by category (for comparison)
    const prevExpensesByCategory = bankDb.prepare(
      `SELECT category, ROUND(SUM(CAST(amount AS REAL)), 2) as total
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND category NOT IN (${excludeList})
       AND category IS NOT NULL AND date >= ? AND date <= ?
       GROUP BY category`
    ).all(...PAYOUT_CATEGORIES, dateStr(dates.previousStart), dateStr(dates.previousEnd)) as {
      category: string; total: number;
    }[];
    const prevExpenseCatMap = new Map(prevExpensesByCategory.map((e) => [e.category, e.total]));

    // ---------- Menu Performance (top items, current vs previous period) ----------

    const currentItems = salesDb.prepare(
      `SELECT oi.display_name as name, SUM(oi.qty) as qty, ROUND(SUM(oi.gross_sales), 2) as revenue
       FROM order_items oi JOIN orders o ON oi.order_id = o.order_id
       WHERE o.order_status = 'completed' AND oi.event_type NOT IN ('discount', 'refund')
       AND o.date >= ? AND o.date <= ?
       GROUP BY oi.display_name ORDER BY revenue DESC LIMIT 10`
    ).all(dateStr(dates.currentStart), dateStr(dates.currentEnd)) as { name: string; qty: number; revenue: number }[];

    const prevItems = salesDb.prepare(
      `SELECT oi.display_name as name, ROUND(SUM(oi.gross_sales), 2) as revenue
       FROM order_items oi JOIN orders o ON oi.order_id = o.order_id
       WHERE o.order_status = 'completed' AND oi.event_type NOT IN ('discount', 'refund')
       AND o.date >= ? AND o.date <= ?
       GROUP BY oi.display_name`
    ).all(dateStr(dates.previousStart), dateStr(dates.previousEnd)) as { name: string; revenue: number }[];

    const prevItemMap = new Map(prevItems.map((i) => [i.name, i.revenue]));

    const menuPerformance = currentItems.map((item) => {
      const prevRev = prevItemMap.get(item.name) || 0;
      const change = prevRev > 0 ? Math.round(((item.revenue - prevRev) / prevRev) * 1000) / 10 : (item.revenue > 0 ? 100 : 0);
      return {
        name: item.name,
        qty: Number(item.qty),
        revenue: Number(item.revenue),
        prevRevenue: prevRev,
        change,
      };
    });

    // ---------- Labor Cost Ratio ----------

    const laborCategories = ["Salary", "Payroll & Salary"];
    const laborPlaceholders = laborCategories.map(() => "?").join(",");

    const curLaborRow = bankDb.prepare(
      `SELECT ROUND(SUM(CAST(amount AS REAL)), 2) as total
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND (category IN (${laborPlaceholders}) OR LOWER(name) LIKE '%salary%' OR LOWER(name) LIKE '%payroll%' OR LOWER(name) LIKE '%gusto%')
       AND date >= ? AND date <= ?`
    ).get(...laborCategories, dateStr(dates.currentStart), dateStr(dates.currentEnd)) as { total: number };

    const prevLaborRow = bankDb.prepare(
      `SELECT ROUND(SUM(CAST(amount AS REAL)), 2) as total
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND (category IN (${laborPlaceholders}) OR LOWER(name) LIKE '%salary%' OR LOWER(name) LIKE '%payroll%' OR LOWER(name) LIKE '%gusto%')
       AND date >= ? AND date <= ?`
    ).get(...laborCategories, dateStr(dates.previousStart), dateStr(dates.previousEnd)) as { total: number };

    const curLabor = curLaborRow.total || 0;
    const prevLabor = prevLaborRow.total || 0;
    const laborCostRatio = curRevenue > 0 ? Math.round((curLabor / curRevenue) * 1000) / 10 : 0;
    const prevLaborCostRatio = prevRevenue > 0 ? Math.round((prevLabor / prevRevenue) * 1000) / 10 : 0;

    // ---------- Daily expense series (for chart overlay) ----------

    const dailyExpenses = bankDb.prepare(
      `SELECT date, ROUND(SUM(CAST(amount AS REAL)), 2) as total
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND category NOT IN (${excludeList})
       AND category IS NOT NULL AND date >= ? AND date <= ?
       GROUP BY date ORDER BY date ASC`
    ).all(...PAYOUT_CATEGORIES, dateStr(chartStart), dateStr(dates.currentEnd)) as { date: string; total: number }[];

    // ---------- Break-even daily amount ----------
    // Use calendar months (not expense-days) for accurate averaging

    const breakEvenData = bankDb.prepare(
      `SELECT COUNT(DISTINCT strftime('%Y-%m', date)) as months, ROUND(SUM(CAST(amount AS REAL)), 2) as total
       FROM all_bank_transactions
       WHERE CAST(amount AS REAL) > 0 AND category NOT IN (${excludeList})
       AND category IS NOT NULL`
    ).get(...PAYOUT_CATEGORIES) as { months: number; total: number };

    const breakEvenDaily = breakEvenData.months > 0
      ? Math.round(((breakEvenData.total || 0) / breakEvenData.months / 30) * 100) / 100
      : 0;

    // ---------- Monthly revenue samples for seasonal indices ----------

    const monthlyRevenueSamples = salesDb.prepare(
      `SELECT CAST(strftime('%m', date) AS INTEGER) as month,
              ROUND(SUM(gross_sales), 2) as total
       FROM orders WHERE order_status = 'completed'
       GROUP BY strftime('%Y-%m', date)`
    ).all() as { month: number; total: number }[];

    // ---------- Reconciliation & Closed Days ----------

    // Reconciliation stats — placeholder until reconciliation is migrated
    const reconStats = { totalPayouts: 0, reconciledPayouts: 0, reconciliationRate: 0 };
    const alertsBySeverity: { severity: string; _count: number }[] = [];
    const recentAlerts: { id: string; type: string; severity: string; message: string; platform: string | null; createdAt: Date }[] = [];

    // Closed days from config-db
    const closedDaysCount = countClosedDaysInRange(dateStr(dates.currentStart), dateStr(dates.currentEnd));

    // Fetch restaurant open date setting
    const restaurantOpenDate = await getSetting(SETTING_KEYS.RESTAURANT_OPEN_DATE);

    // ---------- Compute derived values ----------

    // KPIs
    const curNetProfit = curRevenue - curFees - curExpenses;
    const prevNetProfit = prevRevenue - prevFees - prevExpenses;
    const curProfitMargin =
      curRevenue > 0 ? (curNetProfit / curRevenue) * 100 : 0;
    const prevProfitMargin =
      prevRevenue > 0 ? (prevNetProfit / prevRevenue) * 100 : 0;
    const curOpCostRatio =
      curRevenue > 0 ? ((curFees + curExpenses) / curRevenue) * 100 : 0;
    const prevOpCostRatio =
      prevRevenue > 0 ? ((prevFees + prevExpenses) / prevRevenue) * 100 : 0;

    // Daily series + regression
    const dailyData = dailySeries.map((d) => ({
      date: d.date,
      total: Number(d.total),
      count: Number(d.count),
    }));

    const points = dailyData.map((d, i) => ({ x: i, y: d.total }));
    const reg = linearRegression(points);

    const absSlope = Math.abs(reg.slope);
    const dailyChangeLabel =
      absSlope >= 1
        ? `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(0)}/day`
        : `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(2)}/day`;

    // Seasonal indices
    const seasonalIndices = computeSeasonalIndices(
      monthlyRevenueSamples.map((r) => ({
        month: Number(r.month),
        total: Number(r.total),
      }))
    );
    const hasSeasonalData = monthlyRevenueSamples.length >= 12;

    // Projected end-of-period revenue
    const daysInMonth = getDaysInMonth(now);
    const dayOfMonth = getDate(now);
    const daysRemaining = daysInMonth - dayOfMonth;
    const projectedMonthlyRevenue = curRevenue + reg.slope * daysRemaining;

    // Projected horizon revenue (with seasonal adjustment)
    const lastIdx = dailyData.length - 1;
    let projectedHorizonRevenue = 0;
    for (let j = 1; j <= dates.forecastDays; j++) {
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + j);
      const futureMonth = futureDate.getMonth() + 1;
      const baseProjected = reg.slope * (lastIdx + j) + reg.intercept;
      const seasonalFactor = seasonalIndices[futureMonth] ?? 1.0;
      projectedHorizonRevenue += Math.max(0, baseProjected * seasonalFactor);
    }

    // Platform performance
    const platforms = platformAgg
      .map((p) => {
        const totalFees = p.total_fees || 0;
        const totalSubtotal = p.subtotal || 0;
        const totalNetPayout = p.net_payout || 0;
        const feeRate = totalSubtotal > 0 ? (totalFees / totalSubtotal) * 100 : 0;
        return {
          platform: p.platform,
          orderCount: p.order_count,
          totalSubtotal,
          totalFees,
          totalNetPayout,
          feeRate: Math.round(feeRate * 10) / 10,
          avgNetPerOrder:
            p.order_count > 0 ? Math.round((totalNetPayout / p.order_count) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => b.avgNetPerOrder - a.avgNetPerOrder);

    // Expense health
    const expenseTrendPct = changeDelta(curExpenses, prevPeriodExpenseTotal);
    const expenseTrendDir: "up" | "down" | "flat" =
      expenseTrendPct > 2 ? "up" : expenseTrendPct < -2 ? "down" : "flat";

    // Alert counts
    const alertCountMap: Record<string, number> = { error: 0, warning: 0, info: 0 };
    for (const a of alertsBySeverity) {
      alertCountMap[a.severity] = a._count;
    }

    // Chart lookback in days
    const chartLookbackDays = Math.round(
      (now.getTime() - dates.chartLookbackStart.getTime()) / 86_400_000
    );

    // ---------- Auto-generate insights ----------
    const insights: string[] = [];

    // Revenue trend
    if (prevRevenue > 0) {
      const revChange = changeDelta(curRevenue, prevRevenue);
      if (revChange > 5) {
        insights.push(`Revenue is up ${revChange.toFixed(1)}% ${dates.comparisonLabel} — strong growth.`);
      } else if (revChange < -5) {
        insights.push(`Revenue is down ${Math.abs(revChange).toFixed(1)}% ${dates.comparisonLabel} — investigate what changed.`);
      } else {
        insights.push(`Revenue is stable (${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}%) ${dates.comparisonLabel}.`);
      }
    }

    // Profit margin health
    if (curRevenue > 0) {
      if (curProfitMargin < 0) {
        insights.push(`Operating at a loss — expenses and fees exceed revenue by ${formatCurrency(Math.abs(curNetProfit))}.`);
      } else if (curProfitMargin < 10) {
        insights.push(`Profit margin is thin at ${curProfitMargin.toFixed(1)}% — look for cost-cutting opportunities.`);
      } else if (curProfitMargin >= 20) {
        insights.push(`Healthy profit margin of ${curProfitMargin.toFixed(1)}% — well above industry average.`);
      }
    }

    // Top menu item performance
    if (menuPerformance.length > 0) {
      const topItem = menuPerformance[0];
      insights.push(`Best seller: ${topItem.name} with ${topItem.qty} sold (${formatCurrency(topItem.revenue)} revenue).`);

      // Find fastest growing item
      const growers = menuPerformance.filter((i) => i.prevRevenue > 0 && i.change > 20);
      if (growers.length > 0) {
        const fastest = growers.sort((a, b) => b.change - a.change)[0];
        insights.push(`${fastest.name} is surging — up ${fastest.change.toFixed(0)}% ${dates.comparisonLabel}.`);
      }

      // Find declining items
      const decliners = menuPerformance.filter((i) => i.prevRevenue > 0 && i.change < -20);
      if (decliners.length > 0) {
        const worst = decliners.sort((a, b) => a.change - b.change)[0];
        insights.push(`${worst.name} dropped ${Math.abs(worst.change).toFixed(0)}% — consider promotion or menu review.`);
      }
    }

    // Expense alerts — flag categories growing fast
    const risingExpenses = expensesByCategory
      .map((e) => {
        const prev = prevExpenseCatMap.get(e.category) || 0;
        const change = prev > 0 ? ((Number(e.total) - prev) / prev) * 100 : 0;
        return { category: e.category, total: Number(e.total), prev, change };
      })
      .filter((e) => e.change > 25 && e.prev > 50);
    if (risingExpenses.length > 0) {
      const worst = risingExpenses.sort((a, b) => b.change - a.change)[0];
      insights.push(`${worst.category} spending jumped ${worst.change.toFixed(0)}% (${formatCurrency(worst.prev)} → ${formatCurrency(worst.total)}) — worth reviewing.`);
    }

    // Biggest expense as % of revenue
    if (expensesByCategory.length > 0 && curRevenue > 0) {
      const biggest = expensesByCategory[0];
      const pct = (Number(biggest.total) / curRevenue) * 100;
      if (pct > 30) {
        insights.push(`${biggest.category} accounts for ${pct.toFixed(0)}% of revenue — your largest cost center.`);
      }
    }

    // Labor cost
    if (curLabor > 0 && curRevenue > 0) {
      if (laborCostRatio > 35) {
        insights.push(`Labor costs are ${laborCostRatio.toFixed(1)}% of revenue — above the 25-35% industry benchmark.`);
      } else if (laborCostRatio < 15) {
        insights.push(`Labor at only ${laborCostRatio.toFixed(1)}% of revenue — very lean staffing.`);
      }
    }

    // Platform fee comparison
    const worstFeePlatform = [...platforms].sort((a, b) => b.feeRate - a.feeRate)[0];
    const bestPlatform = [...platforms].sort((a, b) => b.avgNetPerOrder - a.avgNetPerOrder)[0];
    if (worstFeePlatform && worstFeePlatform.feeRate > 20) {
      insights.push(`${capitalize(worstFeePlatform.platform)} takes ${worstFeePlatform.feeRate.toFixed(1)}% in fees — costing you ${formatCurrency(worstFeePlatform.totalFees)} this period.`);
    }
    if (bestPlatform && platforms.length > 1) {
      insights.push(`${capitalize(bestPlatform.platform)} gives you the best net per order at ${formatCurrency(bestPlatform.avgNetPerOrder)}.`);
    }

    // Break-even context
    if (breakEvenDaily > 0 && curRevenue > 0) {
      const avgDailyRevenue = dailyData.length > 0
        ? dailyData.reduce((s, d) => s + d.total, 0) / dailyData.length
        : 0;
      if (avgDailyRevenue > breakEvenDaily * 1.2) {
        insights.push(`Averaging ${formatCurrency(avgDailyRevenue)}/day — comfortably above the ${formatCurrency(breakEvenDaily)}/day break-even point.`);
      } else if (avgDailyRevenue < breakEvenDaily) {
        insights.push(`Daily revenue (${formatCurrency(avgDailyRevenue)}) is below break-even (${formatCurrency(breakEvenDaily)}/day) — need to increase sales or cut costs.`);
      }
    }

    // ---------- Build response ----------
    const dataThrough = now.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    return NextResponse.json({
      kpis: {
        current: {
          revenue: curRevenue,
          fees: curFees,
          expenses: curExpenses,
          netProfit: curNetProfit,
          profitMargin: Math.round(curProfitMargin * 10) / 10,
          operatingCostRatio: Math.round(curOpCostRatio * 10) / 10,
        },
        previous: {
          revenue: prevRevenue,
          fees: prevFees,
          expenses: prevExpenses,
          netProfit: prevNetProfit,
          profitMargin: Math.round(prevProfitMargin * 10) / 10,
          operatingCostRatio: Math.round(prevOpCostRatio * 10) / 10,
        },
        change: {
          revenue: changeDelta(curRevenue, prevRevenue),
          netProfit: changeDelta(curNetProfit, prevNetProfit),
          profitMargin: Math.round((curProfitMargin - prevProfitMargin) * 10) / 10,
          operatingCostRatio:
            Math.round((curOpCostRatio - prevOpCostRatio) * 10) / 10,
        },
      },
      projection: {
        dailySeries: dailyData,
        dailyExpenses: dailyExpenses.map((d) => ({ date: d.date, total: Number(d.total) })),
        breakEvenDaily,
        trend: {
          slope: reg.slope,
          intercept: reg.intercept,
          r2: reg.r2,
          standardError: reg.standardError,
          dailyChangeLabel,
          projectedMonthlyRevenue: Math.round(projectedMonthlyRevenue * 100) / 100,
          confidenceLabel: confidenceLabel(reg.r2),
          projectedHorizonRevenue:
            Math.round(projectedHorizonRevenue * 100) / 100,
          forecastDays: dates.forecastDays,
          chartLookbackDays,
          seasonalIndices,
          hasSeasonalData,
        },
      },
      platforms,
      expenses: {
        currentTotal: curExpenses,
        previousTotal: prevPeriodExpenseTotal,
        trendDirection: expenseTrendDir,
        trendPct: Math.round(Math.abs(expenseTrendPct) * 10) / 10,
        topCategories: expensesByCategory.map((e) => {
          const amt = Number(e.total) || 0;
          const prevAmt = prevExpenseCatMap.get(e.category) || 0;
          return {
            category: e.category || "Uncategorized",
            amount: amt,
            prevAmount: prevAmt,
            pctOfRevenue: curRevenue > 0 ? Math.round((amt / curRevenue) * 1000) / 10 : 0,
            change: prevAmt > 0 ? Math.round(((amt - prevAmt) / prevAmt) * 1000) / 10 : (amt > 0 ? 100 : 0),
          };
        }),
      },
      menuPerformance,
      labor: {
        current: curLabor,
        previous: prevLabor,
        ratio: laborCostRatio,
        prevRatio: prevLaborCostRatio,
        change: Math.round((laborCostRatio - prevLaborCostRatio) * 10) / 10,
      },
      insights,
      meta: {
        closedDays: closedDaysCount,
        closedDayDates: closedDayDates,
        period: dates.periodLabel,
        periodLabel: dates.periodLabel,
        comparisonLabel: dates.comparisonLabel,
        dataThrough,
        restaurantOpenDate,
      },
    });
  } finally {
    salesDb.close();
    bankDb.close();
  }
}
