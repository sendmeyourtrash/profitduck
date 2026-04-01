"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";

import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

// ---------- Helpers ----------

function forecastLabel(days: number): string {
  if (days === 1) return "Next 1 Day";
  if (days <= 7) return `Next ${days} Days`;
  if (days === 30) return "Next 30 Days";
  if (days === 90) return "Next 3 Months";
  return `Next ${days} Days`;
}

// ---------- Data interface ----------

interface KpiBlock {
  revenue: number;
  fees: number;
  expenses: number;
  netProfit: number;
  profitMargin: number;
  operatingCostRatio: number;
}

interface HealthReportData {
  kpis: {
    current: KpiBlock;
    previous: KpiBlock;
    change: {
      revenue: number;
      netProfit: number;
      profitMargin: number;
      operatingCostRatio: number;
    };
  };
  projection: {
    dailySeries: { date: string; total: number; count: number }[];
    dailyExpenses?: { date: string; total: number }[];
    breakEvenDaily?: number;
    trend: {
      slope: number;
      intercept: number;
      r2: number;
      standardError: number;
      dailyChangeLabel: string;
      projectedMonthlyRevenue: number;
      confidenceLabel: string;
      projectedHorizonRevenue: number;
      forecastDays: number;
      chartLookbackDays: number;
      seasonalIndices: Record<number, number>;
      hasSeasonalData: boolean;
    };
  };
  platforms: {
    platform: string;
    orderCount: number;
    totalSubtotal: number;
    totalFees: number;
    totalNetPayout: number;
    feeRate: number;
    avgNetPerOrder: number;
  }[];
  expenses: {
    currentTotal: number;
    previousTotal: number;
    trendDirection: "up" | "down" | "flat";
    trendPct: number;
    topCategories: {
      category: string;
      amount: number;
      prevAmount: number;
      pctOfRevenue: number;
      change: number;
    }[];
  };
  menuPerformance: {
    name: string;
    qty: number;
    revenue: number;
    prevRevenue: number;
    change: number;
  }[];
  labor: {
    current: number;
    previous: number;
    ratio: number;
    prevRatio: number;
    change: number;
  };
  insights: string[];
  meta: {
    closedDays: number;
    closedDayDates: string[];
    period: string;
    periodLabel: string;
    comparisonLabel: string;
    dataThrough: string;
    restaurantOpenDate: string | null;
  };
}

// ---------- Helpers ----------

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  grubhub: "GrubHub",
  ubereats: "Uber Eats",
};

function feeRateClass(rate: number): string {
  if (rate > 25)
    return "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded text-xs font-medium";
  if (rate > 15)
    return "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded text-xs font-medium";
  return "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded text-xs font-medium";
}


// ---------- Component ----------

export default function HealthReportPage() {
  const [data, setData] = useState<HealthReportData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [forecastRange, setForecastRange] = useState<"1m" | "3m" | "6m" | "1y" | "2y">("3m");
  const [compareMode, setCompareMode] = useState<"prior" | "yoy">("prior");
  const [reportTab, setReportTab] = useState<"projections" | "platforms" | "menu" | "goals">("projections");
  const [projInfo, setProjInfo] = useState<{
    forecastLabel: string;
    projectedRevenue: number;
    trendRevenue: number;
    monthlyAvg?: number;
    dailyTrend: string;
    confidence: string;
    r2: number;
    lookbackDays: number;
    period: "1D" | "1W" | "1M" | "1Q";
    scenarios?: {
      worst: { trend: number };
      mid: { trend: number };
      best: { trend: number };
    };
  } | null>(null);
  const [forecastPage, setForecastPage] = useState(0);
  const { startDate, endDate } = useDateRange();

  const fetchReport = useCallback(() => {
    setRefreshing(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    else params.set("period", "all");
    if (endDate) params.set("endDate", endDate);
    if (compareMode === "yoy") params.set("compare", "yoy");
    fetch(`/api/health-report?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setRefreshing(false));
  }, [startDate, endDate, compareMode]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Derived forecast days from API response
  const forecastDays = data?.projection.trend.forecastDays ?? 30;

  // Reset forecast table page when chart period changes
  const prevPeriodRef = useRef(projInfo?.period);
  useEffect(() => {
    if (projInfo?.period && projInfo.period !== prevPeriodRef.current) {
      setForecastPage(0);
      prevPeriodRef.current = projInfo.period;
    }
  }, [projInfo?.period]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const { weekOverWeek, kpis, projection, platforms, expenses, menuPerformance, insights, meta } =
    data;

  return (
    <div className={`space-y-6 transition-opacity duration-200 ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {meta.periodLabel} &middot; Data through {meta.dataThrough}
          {meta.closedDays > 0 && (
            <span className="ml-2 text-amber-500">
              ({meta.closedDays} closed day
              {meta.closedDays !== 1 ? "s" : ""})
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {/* Comparison mode toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            {([
              { value: "prior" as const, label: "Prior Period" },
              { value: "yoy" as const, label: "vs Last Year" },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCompareMode(opt.value)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  compareMode === opt.value
                    ? "bg-white dark:bg-gray-800 text-indigo-600 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchReport}
            className="px-3 py-1.5 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Key Insights — the headline of the health report */}
      {insights.length > 0 && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl p-5">
          <h3 className="text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-3">
            Key Insights
          </h3>
          <ul className="columns-1 md:columns-2 gap-x-8 space-y-1.5">
            {insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-indigo-900 dark:text-indigo-200 break-inside-avoid">
                <span className="text-indigo-400 mt-0.5 shrink-0">&bull;</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Week-over-Week Trends */}
      {weekOverWeek && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">This Week vs Last Week</h3>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {weekOverWeek.thisWeek.daysCompleted} of 7 days
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Revenue", value: formatCurrency(weekOverWeek.thisWeek.revenue), change: weekOverWeek.change.revenue },
              { label: "Orders", value: weekOverWeek.thisWeek.orders.toLocaleString(), change: weekOverWeek.change.orders },
              { label: "Avg Ticket", value: formatCurrency(weekOverWeek.thisWeek.avgTicket), change: weekOverWeek.change.avgTicket },
              { label: "Profit", value: formatCurrency(weekOverWeek.thisWeek.profit), change: weekOverWeek.change.profit, isProfit: true },
              { label: "Fees", value: formatCurrency(weekOverWeek.thisWeek.fees), change: weekOverWeek.change.fees, invertColor: true },
              {
                label: "Busiest Day",
                value: weekOverWeek.thisWeek.busiestDay?.name || "—",
                subtitle: weekOverWeek.thisWeek.busiestDay ? formatCurrency(weekOverWeek.thisWeek.busiestDay.revenue) : undefined,
              },
            ].map((card) => (
              <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">{card.label}</p>
                <p className={`text-lg font-semibold mt-0.5 ${
                  card.isProfit
                    ? (weekOverWeek.thisWeek.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600")
                    : "text-gray-800 dark:text-gray-200"
                }`}>
                  {card.value}
                </p>
                {card.change != null ? (
                  <p className={`text-xs font-medium mt-0.5 ${
                    card.invertColor
                      ? (card.change > 0 ? "text-red-500" : card.change < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400")
                      : (card.change > 0 ? "text-emerald-600 dark:text-emerald-400" : card.change < 0 ? "text-red-500" : "text-gray-400")
                  }`}>
                    {card.change > 0 ? "↑" : card.change < 0 ? "↓" : "→"} {Math.abs(card.change)}% vs last week
                  </p>
                ) : card.subtitle ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{card.subtitle}</p>
                ) : null}
              </div>
            ))}
          </div>
          {weekOverWeek.thisWeek.daysCompleted < 7 && weekOverWeek.projectedWeek && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              At this pace: ~{formatCurrency(weekOverWeek.projectedWeek.revenue)} revenue / ~{weekOverWeek.projectedWeek.orders} orders by end of week
            </p>
          )}
        </div>
      )}

      {/* Section 1: Executive Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Revenue"
          value={formatCurrency(kpis.current.revenue)}
          subtitle={`Prev: ${formatCurrency(kpis.previous.revenue)}`}
          trend={{ value: kpis.change.revenue, label: meta.comparisonLabel }}
        />
        <StatCard
          title="Net Profit"
          value={formatCurrency(kpis.current.netProfit)}
          subtitle={`Fees: ${formatCurrency(kpis.current.fees)} + Expenses: ${formatCurrency(kpis.current.expenses)}`}
          variant={kpis.current.netProfit >= 0 ? "success" : "danger"}
          trend={{ value: kpis.change.netProfit, label: meta.comparisonLabel }}
          info={`Based on tracked platform revenue minus fees and recorded expenses${meta.restaurantOpenDate ? ` since ${new Date(meta.restaurantOpenDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. Does not include COGS, labor, rent, or other costs not imported into the app.`}
        />
        <StatCard
          title="Profit Margin"
          value={`${kpis.current.profitMargin.toFixed(1)}%`}
          subtitle={`Prev: ${kpis.previous.profitMargin.toFixed(1)}%`}
          variant={
            kpis.current.profitMargin >= 15
              ? "success"
              : kpis.current.profitMargin >= 8
                ? "default"
                : "danger"
          }
          trend={{
            value: kpis.change.profitMargin,
            label: `pts ${meta.comparisonLabel}`,
          }}
          info="Derived from net profit — same data limitations apply."
        />
        <StatCard
          title="Operating Cost Ratio"
          value={`${kpis.current.operatingCostRatio.toFixed(1)}%`}
          subtitle="(Fees + Expenses) / Revenue"
          variant={
            kpis.current.operatingCostRatio <= 70
              ? "success"
              : kpis.current.operatingCostRatio <= 85
                ? "warning"
                : "danger"
          }
          trend={{
            value: -kpis.change.operatingCostRatio,
            label: `pts ${meta.comparisonLabel}`,
          }}
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg w-fit overflow-x-auto scrollbar-hide">
        {([
          { key: "projections", label: "Projections" },
          { key: "platforms", label: "Platforms" },
          { key: "menu", label: "Menu & Expenses" },
          { key: "goals", label: "Goals" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setReportTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              reportTab === t.key
                ? "bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Projections */}
      {reportTab === "projections" && (<div className="space-y-6">

      {/* Section 2: Income Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart
            data={projection.dailySeries}
            title={`${meta.periodLabel} Revenue vs Expenses`}
            showControls={true}
            projectionDays={forecastDays}
            expenseData={projection.dailyExpenses}
            breakEvenDaily={projection.breakEvenDaily}
            externalForecastRange={forecastRange}
            onProjectionChange={setProjInfo}
            regressionR2={projection.trend.r2}
            regressionSlope={projection.trend.slope}
            regressionIntercept={projection.trend.intercept}
            regressionStandardError={projection.trend.standardError}
            chartLookbackDays={projection.trend.chartLookbackDays}
            closedDates={meta.closedDayDates}
          />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Income Projection</h3>
            <select
              value={forecastRange}
              onChange={(e) => { setForecastRange(e.target.value as typeof forecastRange); setForecastPage(0); }}
              className="text-[11px] border border-gray-200 dark:border-gray-600 rounded-md px-1.5 py-0.5 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              <option value="1m">1m</option>
              <option value="3m">3m</option>
              <option value="6m">6m</option>
              <option value="1y">1y</option>
              <option value="2y">2y</option>
            </select>
          </div>

          <div>
            <p className="text-xs text-gray-400">Trend</p>
            <p
              className={`text-2xl font-bold ${
                projection.trend.slope >= 0
                  ? "text-emerald-600"
                  : "text-red-600"
              }`}
            >
              {projInfo?.dailyTrend || projection.trend.dailyChangeLabel}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2">
              Projected Revenue ({projInfo?.forecastLabel || forecastLabel(forecastDays)})
            </p>
            {projInfo?.scenarios ? (
              <div className="space-y-0.5">
                {/* Best case */}
                <div className="flex items-baseline justify-between py-1">
                  <span className="text-[10px] text-emerald-500 font-medium">Best</span>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{formatCurrency(projInfo.scenarios.best.trend)}</span>
                </div>
                {/* Mid case */}
                <div className="flex items-baseline justify-between py-1 bg-gray-50 dark:bg-gray-700/50 -mx-2 px-2 rounded">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Expected</span>
                  <span className="text-base font-bold text-gray-900 dark:text-gray-100">{formatCurrency(projInfo.scenarios.mid.trend)}</span>
                </div>
                {/* Worst case */}
                <div className="flex items-baseline justify-between py-1">
                  <span className="text-[10px] text-red-500 font-medium">Worst</span>
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{formatCurrency(projInfo.scenarios.worst.trend)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">Projected</span>
                <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {formatCurrency(projInfo?.trendRevenue ?? projection.trend.projectedHorizonRevenue)}
                </span>
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Period to date: {formatCurrency(kpis.current.revenue)}
            </p>
            {projInfo?.monthlyAvg != null && projInfo.monthlyAvg > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-medium">
                ~{formatCurrency(projInfo.monthlyAvg)}/mo avg
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400">Forecast Confidence</p>
            {(() => {
              const r2 = projInfo?.r2 ?? projection.trend.r2;
              const pct = Math.round(r2 * 100);
              return (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span
                    className={`text-lg font-bold ${
                      r2 >= 0.7 ? "text-emerald-600" : r2 >= 0.4 ? "text-amber-600" : "text-red-600"
                    }`}
                  >
                    {pct}%
                  </span>
                  <span className="text-xs text-gray-400">R²={r2.toFixed(2)}</span>
                </div>
              );
            })()}
            <p className="text-xs text-gray-400 mt-1">
              Based on {projInfo?.lookbackDays ?? projection.trend.chartLookbackDays} days &middot; linear regression
            </p>
          </div>
          {projection.dailySeries.length < 7 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
              Limited data available — projections may be unreliable.
            </p>
          )}
        </div>
      </div>

      {/* Forecast Breakdown — adapts to chart period (daily/weekly/monthly/quarterly) */}
      {projection.trend.slope != null && projection.trend.intercept != null && (() => {
        const FORECAST_DAYS_MAP: Record<string, number> = { "1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730 };
        const totalForecastDays = FORECAST_DAYS_MAP[forecastRange] || 90;
        const slope = projection.trend.slope;
        const intercept = projection.trend.intercept;
        const lastIdx = projection.dailySeries.length - 1;
        const lastDate = projection.dailySeries.length > 0
          ? new Date(projection.dailySeries[projection.dailySeries.length - 1].date + "T12:00:00")
          : new Date();
        const period = projInfo?.period || "1M";
        const monthIndices = projection.trend.seasonalIndices || {};
        const dowIndices: Record<number, number> = projection.trend.dowIndices || {};
        const hasSeasonalData = projection.trend.hasSeasonalData;
        const hasDowData = projection.trend.hasDowData;
        const useDow = hasDowData && (period === "1D" || period === "1W");
        const PERIOD_LABELS: Record<string, string> = { "1D": "Day", "1W": "Week", "1M": "Month", "1Q": "Quarter" };
        const PERIOD_DAYS: Record<string, number> = { "1D": 1, "1W": 7, "1M": 30, "1Q": 91 };
        const periodDays = PERIOD_DAYS[period] || 30;
        const periodLabel = PERIOD_LABELS[period] || "Period";

        // Build rows by stepping through forecast days in period-sized chunks
        type ForecastRow = { label: string; month: number; trendTotal: number; seasonalTotal: number; factor: number; daysUsed: number };
        const rows: ForecastRow[] = [];
        let dayOffset = 1;

        while (dayOffset <= totalForecastDays) {
          const startDate = new Date(lastDate);
          startDate.setDate(startDate.getDate() + dayOffset);

          let trendSum = 0;
          let seasonalSum = 0;
          let daysUsed = 0;
          let bucketMonth = startDate.getMonth();
          let bucketYear = startDate.getFullYear();

          // For daily: 1 day per row
          // For weekly: 7 days per row
          // For monthly: advance to next month boundary
          // For quarterly: advance to next quarter boundary
          const isMonthBased = period === "1M" || period === "1Q";
          const targetDays = isMonthBased ? 0 : periodDays; // 0 = use calendar boundaries

          let label: string;
          if (period === "1D") {
            const dow = startDate.toLocaleDateString("en-US", { weekday: "short" });
            label = `${dow}, ${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
          } else if (period === "1W") {
            // Week number: ISO week = ceil((dayOfYear + startDayOfWeek) / 7)
            const jan1 = new Date(startDate.getFullYear(), 0, 1);
            const dayOfYear = Math.floor((startDate.getTime() - jan1.getTime()) / 86_400_000) + 1;
            const weekNum = Math.ceil(dayOfYear / 7);
            label = `Wk ${weekNum} — ${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
          } else if (period === "1M") {
            label = startDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          } else {
            const q = Math.floor(startDate.getMonth() / 3) + 1;
            label = `Q${q} ${startDate.getFullYear()}`;
          }

          while (dayOffset <= totalForecastDays) {
            const d = new Date(lastDate);
            d.setDate(d.getDate() + dayOffset);

            // Check if we've crossed into next period
            if (isMonthBased) {
              if (period === "1M" && (d.getMonth() !== bucketMonth || d.getFullYear() !== bucketYear)) break;
              if (period === "1Q") {
                const startQ = Math.floor(bucketMonth / 3);
                const curQ = Math.floor(d.getMonth() / 3);
                if (curQ !== startQ || d.getFullYear() !== bucketYear) break;
              }
            } else if (daysUsed >= targetDays) {
              break;
            }

            const dayIdx = lastIdx + dayOffset;
            const trendVal = slope * dayIdx + intercept;
            const monthNum = d.getMonth() + 1;
            const monthFactor = monthIndices[monthNum] ?? 1.0;
            const dowFactor = useDow ? (dowIndices[d.getDay()] ?? 1.0) : 1.0;
            const factor = monthFactor * dowFactor;
            trendSum += trendVal;
            seasonalSum += trendVal * factor;
            daysUsed++;
            dayOffset++;
          }

          // Normalize partial periods at boundaries
          let expectedDays = periodDays;
          if (period === "1M") expectedDays = new Date(bucketYear, bucketMonth + 1, 0).getDate();
          if (period === "1Q") expectedDays = period === "1Q" ? 91 : periodDays;
          const scale = (daysUsed < expectedDays && daysUsed > 0) ? expectedDays / daysUsed : 1;
          const avgFactor = trendSum > 0 ? seasonalSum / trendSum : 1;

          rows.push({
            label,
            month: startDate.getMonth() + 1,
            trendTotal: trendSum * scale,
            seasonalTotal: seasonalSum * scale,
            factor: avgFactor,
            daysUsed,
          });
        }

        const PAGE_SIZE = 10;
        const totalPages = Math.ceil(rows.length / PAGE_SIZE);
        const page = Math.min(forecastPage, totalPages - 1);
        const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const trendGrandTotal = rows.reduce((s, m) => s + m.trendTotal, 0);
        const seasonalGrandTotal = rows.reduce((s, m) => s + m.seasonalTotal, 0);

        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Forecast Breakdown <span className="text-gray-400 dark:text-gray-500 font-normal">by {periodLabel}</span>
              </h3>
              <span className="text-xs text-gray-400">{rows.length} periods</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                    <th className="pb-2 font-medium">{periodLabel}</th>
                    <th className="pb-2 font-medium text-right">Trend Forecast</th>
                    {hasSeasonalData && <th className="pb-2 font-medium text-right">Seasonal Adjusted</th>}
                    {hasSeasonalData && <th className="pb-2 font-medium text-right">Factor</th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((m, i) => (
                    <tr key={`${m.label}-${i}`} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="py-2 text-gray-800 dark:text-gray-200 font-medium">{m.label}</td>
                      <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(m.trendTotal)}</td>
                      {hasSeasonalData && (
                        <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(m.seasonalTotal)}</td>
                      )}
                      {hasSeasonalData && (
                        <td className="py-2 text-right">
                          <span className={`text-xs font-medium ${
                            m.factor > 1.05 ? "text-emerald-600 dark:text-emerald-400"
                            : m.factor < 0.95 ? "text-red-500"
                            : "text-gray-500 dark:text-gray-400"
                          }`}>
                            {m.factor.toFixed(2)}×
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 dark:border-gray-600 font-medium">
                    <td className="py-2 text-gray-800 dark:text-gray-200">Total</td>
                    <td className="py-2 text-right font-bold text-gray-900 dark:text-gray-100">{formatCurrency(trendGrandTotal)}</td>
                    {hasSeasonalData && (
                      <td className="py-2 text-right font-bold text-gray-900 dark:text-gray-100">{formatCurrency(seasonalGrandTotal)}</td>
                    )}
                    {hasSeasonalData && <td></td>}
                  </tr>
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/50">
                <button
                  onClick={() => setForecastPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-400">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setForecastPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        );
      })()}

      </div>)}

      {/* Tab: Platforms */}
      {reportTab === "platforms" && (<div className="space-y-6">

      {/* Section 3: Platform Performance */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          Platform Performance
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 font-medium">Platform</th>
                <th className="pb-2 font-medium text-right">Orders</th>
                <th className="pb-2 font-medium text-right">Gross Revenue</th>
                <th className="pb-2 font-medium text-right">Total Fees</th>
                <th className="pb-2 font-medium text-right">Fee Rate</th>
                <th className="pb-2 font-medium text-right">Net Payout</th>
                <th className="pb-2 font-medium text-right">Avg Net/Order</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <tr
                  key={p.platform}
                  className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 text-gray-800 dark:text-gray-200"
                >
                  <td className="py-2.5 font-medium">
                    {PLATFORM_LABELS[p.platform] || p.platform}
                  </td>
                  <td className="py-2.5 text-right">
                    {p.orderCount.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right">
                    {formatCurrency(p.totalSubtotal)}
                  </td>
                  <td className="py-2.5 text-right text-red-600 dark:text-red-400">
                    {formatCurrency(p.totalFees)}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={feeRateClass(p.feeRate)}>
                      {p.feeRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(p.totalNetPayout)}
                  </td>
                  <td className="py-2.5 text-right font-medium">
                    {formatCurrency(p.avgNetPerOrder)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </div>)}

      {/* Tab: Menu & Expenses */}
      {reportTab === "menu" && (<div className="space-y-6">

      {/* Section 4: Menu Performance + Expense Breakdown (side by side) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Menu Performance */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Menu Performance
            <span className="text-xs text-gray-400 dark:text-gray-500 font-normal ml-2">{meta.comparisonLabel}</span>
          </h3>
          {menuPerformance.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No item data available for this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 font-medium">Item</th>
                  <th className="pb-2 font-medium text-right">Qty</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {menuPerformance.map((item) => (
                  <tr key={item.name} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="py-2 text-gray-800 dark:text-gray-200 font-medium truncate max-w-[140px]">{item.name}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{item.qty.toLocaleString()}</td>
                    <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(item.revenue)}</td>
                    <td className="py-2 text-right">
                      {item.prevRevenue > 0 ? (
                        <span className={`text-xs font-medium ${item.change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {item.change >= 0 ? "↑" : "↓"} {Math.abs(item.change)}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">new</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Expense Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Expense Breakdown</h3>
            <div className={`flex items-center gap-1 text-xs font-medium ${
              expenses.trendDirection === "up" ? "text-red-600"
                : expenses.trendDirection === "down" ? "text-emerald-600"
                : "text-gray-500"
            }`}>
              {expenses.trendDirection === "up" ? "↑" : expenses.trendDirection === "down" ? "↓" : "→"}
              <span>{expenses.trendPct.toFixed(1)}% {meta.comparisonLabel}</span>
            </div>
          </div>
          {expenses.topCategories.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No expense data for this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium text-right">% Rev</th>
                  <th className="pb-2 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {expenses.topCategories.map((c) => (
                  <tr key={c.category} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="py-2 text-gray-800 dark:text-gray-200 font-medium truncate max-w-[140px]">{c.category}</td>
                    <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(c.amount)}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        c.pctOfRevenue > 20 ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                          : c.pctOfRevenue > 10 ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
                          : "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                      }`}>
                        {c.pctOfRevenue.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {c.prevAmount > 0 ? (
                        <span className={`text-xs font-medium ${c.change <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {c.change > 0 ? "↑" : "↓"} {Math.abs(c.change)}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                  <td className="py-2 text-gray-800 dark:text-gray-200">Total</td>
                  <td className="py-2 text-right text-gray-800 dark:text-gray-200">{formatCurrency(expenses.currentTotal)}</td>
                  <td className="py-2 text-right">
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      {kpis.current.revenue > 0 ? ((expenses.currentTotal / kpis.current.revenue) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={`text-xs font-medium ${expenses.trendDirection === "down" ? "text-emerald-600 dark:text-emerald-400" : expenses.trendDirection === "up" ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>
                      {expenses.trendDirection === "up" ? "↑" : expenses.trendDirection === "down" ? "↓" : "→"} {expenses.trendPct.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>

      </div>)}

      {/* Tab: Goals */}
      {reportTab === "goals" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">Goals & Alerts</h3>
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
            Goal tracking, cost alerts, and cash flow forecast coming soon.
          </p>
        </div>
      )}

    </div>
  );
}
