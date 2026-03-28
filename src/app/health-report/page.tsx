"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  const [seasonalOn, setSeasonalOn] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [forecastRange, setForecastRange] = useState<"1m" | "3m" | "6m" | "1y" | "2y">("3m");
  const [compareMode, setCompareMode] = useState<"prior" | "yoy">("prior");
  const [projInfo, setProjInfo] = useState<{
    forecastLabel: string;
    projectedRevenue: number;
    trendRevenue: number;
    seasonalRevenue: number;
    unadjustedRevenue?: number;
    monthlyAvg?: number;
    isSeasonallyAdjusted: boolean;
    dailyTrend: string;
    confidence: string;
    r2: number;
    lookbackDays: number;
    seasonalCallout?: string;
    scenarios?: {
      worst: { trend: number; seasonal: number };
      mid: { trend: number; seasonal: number };
      best: { trend: number; seasonal: number };
    };
  } | null>(null);
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

  // Compute seasonal projection points for the chart
  const seasonalProjectionPoints = useMemo(() => {
    if (!data || !seasonalOn) return undefined;
    const { dailySeries, trend } = data.projection;
    if (dailySeries.length === 0) return undefined;

    const lastDate = new Date(dailySeries[dailySeries.length - 1].date);
    const lastIdx = dailySeries.length - 1;
    const points: { date: string; seasonal: number }[] = [];

    for (let j = 1; j <= forecastDays; j++) {
      const futureDate = new Date(lastDate);
      futureDate.setDate(futureDate.getDate() + j);
      const futureMonth = futureDate.getMonth() + 1; // 1-12
      const baseVal = trend.slope * (lastIdx + j) + trend.intercept;
      const factor = trend.seasonalIndices[futureMonth] ?? 1.0;
      points.push({
        date: futureDate.toISOString().slice(0, 10),
        seasonal: Math.max(0, baseVal * factor),
      });
    }
    return points;
  }, [data, seasonalOn, forecastDays]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const { kpis, projection, platforms, expenses, menuPerformance, insights, meta } =
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

      {/* Section 2: Income Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart
            data={projection.dailySeries}
            title={`${meta.periodLabel} Revenue vs Expenses`}
            showControls={true}
            projectionDays={forecastDays}
            seasonalProjectionPoints={seasonalProjectionPoints}
            seasonalOn={seasonalOn}
            onSeasonalToggle={setSeasonalOn}
            seasonalIndices={projection.trend.seasonalIndices}
            expenseData={projection.dailyExpenses}
            breakEvenDaily={projection.breakEvenDaily}
            externalForecastRange={forecastRange}
            onProjectionChange={setProjInfo}
            regressionR2={projection.trend.r2}
            chartLookbackDays={projection.trend.chartLookbackDays}
          />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Income Projection</h3>
            <select
              value={forecastRange}
              onChange={(e) => setForecastRange(e.target.value as typeof forecastRange)}
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
                {/* Header row */}
                <div className="grid grid-cols-3 gap-1 text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide pb-1 border-b border-gray-100 dark:border-gray-700">
                  <span></span>
                  <span className="text-right">Trend</span>
                  <span className="text-right text-violet-400">Seasonal</span>
                </div>
                {/* Best case */}
                <div className="grid grid-cols-3 gap-1 items-baseline py-1">
                  <span className="text-[10px] text-emerald-500 font-medium">Best</span>
                  <span className="text-sm font-bold text-right text-gray-700 dark:text-gray-300">{formatCurrency(projInfo.scenarios.best.trend)}</span>
                  <span className="text-sm font-bold text-right text-violet-600">{formatCurrency(projInfo.scenarios.best.seasonal)}</span>
                </div>
                {/* Mid case */}
                <div className="grid grid-cols-3 gap-1 items-baseline py-1 bg-gray-50 dark:bg-gray-700/50 -mx-2 px-2 rounded">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Expected</span>
                  <span className="text-base font-bold text-right text-gray-900 dark:text-gray-100">{formatCurrency(projInfo.scenarios.mid.trend)}</span>
                  <span className="text-base font-bold text-right text-violet-700">{formatCurrency(projInfo.scenarios.mid.seasonal)}</span>
                </div>
                {/* Worst case */}
                <div className="grid grid-cols-3 gap-1 items-baseline py-1">
                  <span className="text-[10px] text-red-500 font-medium">Worst</span>
                  <span className="text-sm font-bold text-right text-gray-700 dark:text-gray-300">{formatCurrency(projInfo.scenarios.worst.trend)}</span>
                  <span className="text-sm font-bold text-right text-violet-600">{formatCurrency(projInfo.scenarios.worst.seasonal)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Trend</span>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatCurrency(projInfo?.trendRevenue ?? projection.trend.projectedHorizonRevenue)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-violet-500 dark:text-violet-400">Seasonal</span>
                  <span className="text-lg font-bold text-violet-700 dark:text-violet-400">
                    {formatCurrency(projInfo?.seasonalRevenue ?? projection.trend.projectedHorizonRevenue)}
                  </span>
                </div>
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
            {projInfo?.isSeasonallyAdjusted && !projection.trend.hasSeasonalData && (
              <p className="text-xs text-amber-500 mt-1">
                Seasonal: limited historical data (&lt;12 months)
              </p>
            )}
          </div>
          {projInfo?.seasonalCallout && (
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-2.5">
              <p className="text-xs text-violet-700 dark:text-violet-300">
                {projInfo.seasonalCallout}
              </p>
            </div>
          )}
          {projection.dailySeries.length < 7 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
              Limited data available — projections may be unreliable.
            </p>
          )}
        </div>
      </div>

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

    </div>
  );
}
