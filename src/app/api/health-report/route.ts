import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { linearRegression, computeSeasonalIndices } from "@/lib/utils/statistics";
import { getReconciliationStats } from "@/lib/services/reconciliation";
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
  getDaysInMonth,
  getDate,
} from "date-fns";
import { formatCurrency } from "@/lib/utils/format";

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

function resolvePeriodDates(period: Period, now: Date): PeriodDateRanges {
  switch (period) {
    case "1d": {
      const currentStart = startOfDay(now);
      const currentEnd = endOfDay(now);
      const previousStart = startOfDay(subDays(now, 1));
      const previousEnd = endOfDay(subDays(now, 1));
      const chartLookbackStart = subDays(now, 14);
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 1,
        periodLabel: "Today",
        comparisonLabel: "vs yesterday",
      };
    }
    case "1w": {
      const currentStart = startOfDay(subDays(now, 6));
      const currentEnd = endOfDay(now);
      const previousStart = startOfDay(subDays(now, 13));
      const previousEnd = endOfDay(subDays(now, 7));
      const chartLookbackStart = subDays(now, 30);
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 7,
        periodLabel: "This Week",
        comparisonLabel: "vs prior week",
      };
    }
    case "1m": {
      const currentStart = startOfMonth(now);
      const currentEnd = endOfDay(now);
      const previousStart = startOfMonth(subMonths(now, 1));
      const previousEnd = endOfMonth(subMonths(now, 1));
      const chartLookbackStart = subDays(now, 90);
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
        comparisonLabel: "vs last month",
      };
    }
    case "1q": {
      const currentStart = startOfQuarter(now);
      const currentEnd = endOfDay(now);
      const previousStart = startOfQuarter(subQuarters(now, 1));
      const previousEnd = endOfQuarter(subQuarters(now, 1));
      const chartLookbackStart = subDays(now, 365);
      return {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
        chartLookbackStart,
        forecastDays: 90,
        periodLabel: `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`,
        comparisonLabel: "vs last quarter",
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

async function sumTransactions(
  type: string,
  start: Date,
  end: Date
): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: { type, date: { gte: start, lte: end } },
    _sum: { amount: true },
  });
  return result._sum.amount || 0;
}

async function sumExpenses(start: Date, end: Date): Promise<number> {
  const result = await prisma.expense.aggregate({
    where: { date: { gte: start, lte: end } },
    _sum: { amount: true },
  });
  return result._sum.amount || 0;
}

// ---------- GET handler ----------

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Parse and validate period param
  const rawPeriod = searchParams.get("period") ?? "1m";
  const period: Period = VALID_PERIODS.includes(rawPeriod as Period)
    ? (rawPeriod as Period)
    : "1m";

  const now = new Date();
  const dates = resolvePeriodDates(period, now);

  // ---------- Parallel query groups ----------

  const [
    // Group A: Period KPIs
    curRevenue,
    curFees,
    curExpenses,
    prevRevenue,
    prevFees,
    prevExpenses,

    // Group B: Daily series (chart lookback)
    dailySeries,

    // Group C: Platform aggregates
    platformAgg,

    // Group D: Expense by category (current period)
    expensesByCategory,
    prevPeriodExpenseTotal,

    // Group E: Reconciliation
    reconStats,
    alertsBySeverity,
    recentAlerts,

    // Group F: Closed days (current period)
    closedDaysCount,

    // Group G: All-time monthly revenue for seasonal indices
    monthlyRevenueSamples,
  ] = await Promise.all([
    // A
    sumTransactions("income", dates.currentStart, dates.currentEnd),
    sumTransactions("fee", dates.currentStart, dates.currentEnd),
    sumExpenses(dates.currentStart, dates.currentEnd),
    sumTransactions("income", dates.previousStart, dates.previousEnd),
    sumTransactions("fee", dates.previousStart, dates.previousEnd),
    sumExpenses(dates.previousStart, dates.previousEnd),

    // B
    prisma.$queryRawUnsafe<
      { date: string; total: number; count: number }[]
    >(
      `SELECT date(date) as date, SUM(amount) as total, COUNT(*) as count
       FROM transactions
       WHERE type = 'income' AND date >= ?
       GROUP BY date(date)
       ORDER BY date(date) ASC`,
      dates.chartLookbackStart.toISOString()
    ),

    // C
    prisma.platformOrder.groupBy({
      by: ["platform"],
      _sum: {
        subtotal: true,
        commissionFee: true,
        serviceFee: true,
        deliveryFee: true,
        netPayout: true,
        tip: true,
      },
      _count: true,
    }),

    // D
    prisma.expense.groupBy({
      by: ["category"],
      where: { date: { gte: dates.currentStart, lte: dates.currentEnd } },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: "desc" } },
      take: 10,
    }),
    sumExpenses(dates.previousStart, dates.previousEnd),

    // E
    getReconciliationStats(),
    prisma.reconciliationAlert.groupBy({
      by: ["severity"],
      where: { resolved: false },
      _count: true,
    }),
    prisma.reconciliationAlert.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    // F
    prisma.closedDay.count({
      where: { date: { gte: dates.currentStart, lte: dates.currentEnd } },
    }),

    // G
    prisma.$queryRawUnsafe<{ month: number; total: number }[]>(
      `SELECT CAST(strftime('%m', date) AS INTEGER) as month,
              SUM(amount) as total
       FROM transactions
       WHERE type = 'income'
       GROUP BY strftime('%Y-%m', date)`
    ),
  ]);

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

  // Projected end-of-period revenue (for current month context)
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
    const futureMonth = futureDate.getMonth() + 1; // 1-12
    const baseProjected = reg.slope * (lastIdx + j) + reg.intercept;
    const seasonalFactor = seasonalIndices[futureMonth] ?? 1.0;
    projectedHorizonRevenue += Math.max(0, baseProjected * seasonalFactor);
  }

  // Platform performance
  const platforms = platformAgg
    .map((p) => {
      const totalFees =
        (p._sum.commissionFee || 0) +
        (p._sum.serviceFee || 0) +
        (p._sum.deliveryFee || 0);
      const totalSubtotal = p._sum.subtotal || 0;
      const totalNetPayout = p._sum.netPayout || 0;
      const feeRate = totalSubtotal > 0 ? (totalFees / totalSubtotal) * 100 : 0;
      return {
        platform: p.platform,
        orderCount: p._count,
        totalSubtotal,
        totalFees,
        totalNetPayout,
        feeRate: Math.round(feeRate * 10) / 10,
        avgNetPerOrder:
          p._count > 0 ? Math.round((totalNetPayout / p._count) * 100) / 100 : 0,
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

  // Chart lookback in days (for display)
  const chartLookbackDays = Math.round(
    (now.getTime() - dates.chartLookbackStart.getTime()) / 86_400_000
  );

  // ---------- Auto-generate insights ----------
  const insights: string[] = [];

  if (dailyData.length >= 7) {
    if (reg.slope > 5) {
      insights.push(
        `Revenue is growing at ${dailyChangeLabel} based on ${chartLookbackDays}-day trend.`
      );
    } else if (reg.slope < -5) {
      insights.push(
        `Revenue has been declining at ${dailyChangeLabel} \u2014 review recent weeks.`
      );
    }
  }

  if (prevRevenue > 0) {
    const revChange = changeDelta(curRevenue, prevRevenue);
    if (revChange > 0) {
      insights.push(
        `Revenue is up ${revChange.toFixed(1)}% ${dates.comparisonLabel}.`
      );
    } else if (revChange < -5) {
      insights.push(
        `Revenue is down ${Math.abs(revChange).toFixed(1)}% ${dates.comparisonLabel}.`
      );
    }
  }

  const worstFeePlatform = [...platforms].sort(
    (a, b) => b.feeRate - a.feeRate
  )[0];
  if (worstFeePlatform && worstFeePlatform.feeRate > 20) {
    insights.push(
      `${capitalize(worstFeePlatform.platform)} has the highest fee rate at ${worstFeePlatform.feeRate.toFixed(1)}%, costing ${formatCurrency(worstFeePlatform.totalFees)} total.`
    );
  }

  const totalAlerts =
    alertCountMap.error + alertCountMap.warning + alertCountMap.info;
  if (totalAlerts > 0) {
    insights.push(
      `${totalAlerts} unresolved reconciliation alert${totalAlerts > 1 ? "s" : ""} require attention (${alertCountMap.error} error${alertCountMap.error !== 1 ? "s" : ""}).`
    );
  }

  if (curProfitMargin < 10 && curRevenue > 0) {
    insights.push(
      `Profit margin of ${curProfitMargin.toFixed(1)}% is below 10% \u2014 consider reviewing high-cost categories.`
    );
  }

  if (expenseTrendDir === "up" && expenseTrendPct > 10) {
    insights.push(
      `Operating expenses rose ${expenseTrendPct.toFixed(1)}% ${dates.comparisonLabel}.`
    );
  }

  if (reconStats.reconciliationRate < 50 && reconStats.totalPayouts > 0) {
    insights.push(
      `Only ${reconStats.reconciliationRate}% of payouts are reconciled \u2014 consider matching outstanding deposits.`
    );
  }

  const bestPlatform = platforms[0];
  if (bestPlatform) {
    insights.push(
      `${capitalize(bestPlatform.platform)} yields the highest net per order at ${formatCurrency(bestPlatform.avgNetPerOrder)}.`
    );
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
      trend: {
        slope: reg.slope,
        intercept: reg.intercept,
        r2: reg.r2,
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
      topCategories: expensesByCategory.map((e) => ({
        category: e.category || "Uncategorized",
        amount: e._sum.amount || 0,
        pctOfRevenue:
          curRevenue > 0
            ? Math.round(((e._sum.amount || 0) / curRevenue) * 1000) / 10
            : 0,
      })),
    },
    reconciliation: {
      totalPayouts: reconStats.totalPayouts,
      reconciledPayouts: reconStats.reconciledPayouts,
      reconciliationRate: reconStats.reconciliationRate,
      alertCounts: {
        error: alertCountMap.error,
        warning: alertCountMap.warning,
        info: alertCountMap.info,
        total: totalAlerts,
      },
      recentAlerts: recentAlerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        message: a.message,
        platform: a.platform,
        createdAt: a.createdAt.toISOString(),
      })),
    },
    insights,
    meta: {
      closedDays: closedDaysCount,
      period,
      periodLabel: dates.periodLabel,
      comparisonLabel: dates.comparisonLabel,
      dataThrough,
    },
  });
}
