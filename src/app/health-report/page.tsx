"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import BarChartCard from "@/components/charts/BarChartCard";
import { formatCurrency } from "@/lib/utils/format";

type PeriodOption = 30 | 90 | 180 | 365;

const PERIOD_LABELS: Record<PeriodOption, string> = {
  30: "1m",
  90: "3m",
  180: "6m",
  365: "1y",
};

const HORIZON_LABELS: Record<PeriodOption, string> = {
  30: "1 Month",
  90: "3 Months",
  180: "6 Months",
  365: "12 Months",
};

interface HealthReportData {
  kpis: {
    currentMonth: {
      revenue: number;
      fees: number;
      expenses: number;
      netProfit: number;
      profitMargin: number;
      operatingCostRatio: number;
    };
    previousMonth: {
      revenue: number;
      fees: number;
      expenses: number;
      netProfit: number;
      profitMargin: number;
      operatingCostRatio: number;
    };
    mom: {
      revenue: number;
      netProfit: number;
      profitMargin: number;
      operatingCostRatio: number;
    };
  };
  projection: {
    dailySeries: { date: string; total: number; count: number }[];
    trend: {
      slope: number;
      intercept: number;
      r2: number;
      dailyChangeLabel: string;
      projectedMonthlyRevenue: number;
      confidenceLabel: string;
      projectedHorizonRevenue: number;
      horizonDays: number;
      lookbackDays: number;
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
    currentMonthTotal: number;
    previousMonthTotal: number;
    trendDirection: "up" | "down" | "flat";
    trendPct: number;
    topCategories: {
      category: string;
      amount: number;
      pctOfRevenue: number;
    }[];
  };
  reconciliation: {
    totalPayouts: number;
    reconciledPayouts: number;
    reconciliationRate: number;
    alertCounts: {
      error: number;
      warning: number;
      info: number;
      total: number;
    };
    recentAlerts: {
      id: string;
      type: string;
      severity: string;
      message: string;
      platform: string | null;
      createdAt: string;
    }[];
  };
  insights: string[];
  meta: {
    closedDaysThisMonth: number;
    reportPeriod: string;
    dataThrough: string;
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  grubhub: "GrubHub",
  ubereats: "Uber Eats",
};

function feeRateClass(rate: number): string {
  if (rate > 25)
    return "bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-xs font-medium";
  if (rate > 15)
    return "bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-xs font-medium";
  return "bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-xs font-medium";
}

function severityBadgeClass(severity: string): string {
  if (severity === "error") return "bg-red-100 text-red-700";
  if (severity === "warning") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

export default function HealthReportPage() {
  const [data, setData] = useState<HealthReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookback, setLookback] = useState<PeriodOption>(90);
  const [horizon, setHorizon] = useState<PeriodOption>(90);
  const [seasonalOn, setSeasonalOn] = useState(false);

  const fetchReport = useCallback(() => {
    setLoading(true);
    fetch(`/api/health-report?lookback=${lookback}&horizon=${horizon}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [lookback, horizon]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Compute seasonal projection points for the chart
  const seasonalProjectionPoints = useMemo(() => {
    if (!data || !seasonalOn) return undefined;
    const { dailySeries, trend } = data.projection;
    if (dailySeries.length === 0) return undefined;

    const lastDate = new Date(dailySeries[dailySeries.length - 1].date);
    const lastIdx = dailySeries.length - 1;
    const points: { date: string; seasonal: number }[] = [];

    for (let j = 1; j <= horizon; j++) {
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
  }, [data, seasonalOn, horizon]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Unable to load report data.
      </div>
    );
  }

  const { kpis, projection, platforms, expenses, reconciliation, insights, meta } =
    data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mt-0.5">
            {meta.reportPeriod} &middot; Data through {meta.dataThrough}
            {meta.closedDaysThisMonth > 0 && (
              <span className="ml-2 text-amber-500">
                ({meta.closedDaysThisMonth} closed day
                {meta.closedDaysThisMonth !== 1 ? "s" : ""})
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchReport}
          className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
        >
          Refresh
        </button>
      </div>

      {/* Projection Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-medium">Lookback</span>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([30, 90, 180, 365] as PeriodOption[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setLookback(opt)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  lookback === opt
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {PERIOD_LABELS[opt]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-medium">Forecast</span>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([30, 90, 180, 365] as PeriodOption[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setHorizon(opt)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  horizon === opt
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {PERIOD_LABELS[opt]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Section 1: Executive Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Revenue (This Month)"
          value={formatCurrency(kpis.currentMonth.revenue)}
          subtitle={`Prev: ${formatCurrency(kpis.previousMonth.revenue)}`}
          trend={{ value: kpis.mom.revenue, label: "vs last month" }}
        />
        <StatCard
          title="Net Profit"
          value={formatCurrency(kpis.currentMonth.netProfit)}
          subtitle={`Fees: ${formatCurrency(kpis.currentMonth.fees)} + Expenses: ${formatCurrency(kpis.currentMonth.expenses)}`}
          variant={kpis.currentMonth.netProfit >= 0 ? "success" : "danger"}
          trend={{ value: kpis.mom.netProfit, label: "vs last month" }}
        />
        <StatCard
          title="Profit Margin"
          value={`${kpis.currentMonth.profitMargin.toFixed(1)}%`}
          subtitle={`Prev: ${kpis.previousMonth.profitMargin.toFixed(1)}%`}
          variant={
            kpis.currentMonth.profitMargin >= 15
              ? "success"
              : kpis.currentMonth.profitMargin >= 8
                ? "default"
                : "danger"
          }
          trend={{ value: kpis.mom.profitMargin, label: "pts vs last month" }}
        />
        <StatCard
          title="Operating Cost Ratio"
          value={`${kpis.currentMonth.operatingCostRatio.toFixed(1)}%`}
          subtitle="(Fees + Expenses) / Revenue"
          variant={
            kpis.currentMonth.operatingCostRatio <= 70
              ? "success"
              : kpis.currentMonth.operatingCostRatio <= 85
                ? "warning"
                : "danger"
          }
          trend={{
            value: -kpis.mom.operatingCostRatio,
            label: "pts vs last month",
          }}
        />
      </div>

      {/* Section 2: Income Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart
            data={projection.dailySeries}
            title={`${projection.trend.lookbackDays}-Day Revenue Trend + Projection`}
            showControls={true}
            projectionDays={horizon}
            seasonalProjectionPoints={seasonalProjectionPoints}
            seasonalOn={seasonalOn}
            onSeasonalToggle={setSeasonalOn}
          />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h3 className="text-sm font-medium text-gray-500">
            Income Projection
          </h3>
          <div>
            <p className="text-xs text-gray-400">Daily Trend</p>
            <p
              className={`text-2xl font-bold ${
                projection.trend.slope >= 0
                  ? "text-emerald-600"
                  : "text-red-600"
              }`}
            >
              {projection.trend.dailyChangeLabel}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">
              Projected Revenue (Next {HORIZON_LABELS[horizon as PeriodOption] || `${horizon} Days`})
              {seasonalOn && (
                <span className="ml-1 text-violet-500">&middot; Seasonally Adjusted</span>
              )}
            </p>
            <p className="text-xl font-bold text-gray-900">
              {formatCurrency(projection.trend.projectedHorizonRevenue)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Current month to date: {formatCurrency(kpis.currentMonth.revenue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Forecast Confidence</p>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                projection.trend.r2 >= 0.7
                  ? "bg-emerald-50 text-emerald-700"
                  : projection.trend.r2 >= 0.4
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-600"
              }`}
            >
              {projection.trend.confidenceLabel}
            </span>
            <p className="text-xs text-gray-400 mt-1.5">
              Based on {projection.trend.lookbackDays} days of data &middot; linear regression
            </p>
            {seasonalOn && !projection.trend.hasSeasonalData && (
              <p className="text-xs text-amber-500 mt-1">
                Seasonal: limited historical data (&lt;12 months)
              </p>
            )}
          </div>
          {projection.dailySeries.length < 7 && (
            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
              Limited data available — projections may be unreliable.
            </p>
          )}
        </div>
      </div>

      {/* Section 3: Platform Performance */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Platform Performance (All Time)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
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
                  className="border-b border-gray-50 hover:bg-gray-50"
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
                  <td className="py-2.5 text-right text-red-600">
                    {formatCurrency(p.totalFees)}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className={feeRateClass(p.feeRate)}>
                      {p.feeRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-emerald-600">
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

      {/* Section 4: Expense Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {expenses.topCategories.length > 0 && (
          <BarChartCard
            title="Top Expense Categories (This Month)"
            data={expenses.topCategories.map((c) => ({
              name: c.category,
              value: c.amount,
            }))}
            color="#ef4444"
          />
        )}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="text-sm font-medium text-gray-500">Expense Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">This Month</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(expenses.currentMonthTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Last Month</p>
              <p className="text-xl font-bold text-gray-500">
                {formatCurrency(expenses.previousMonthTotal)}
              </p>
            </div>
          </div>
          <div
            className={`flex items-center gap-2 text-sm font-medium ${
              expenses.trendDirection === "up"
                ? "text-red-600"
                : expenses.trendDirection === "down"
                  ? "text-emerald-600"
                  : "text-gray-500"
            }`}
          >
            {expenses.trendDirection === "up"
              ? "\u2191"
              : expenses.trendDirection === "down"
                ? "\u2193"
                : "\u2192"}
            <span>{expenses.trendPct.toFixed(1)}% vs last month</span>
          </div>
          {expenses.topCategories.length > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-2">
                Top Categories as % of Revenue
              </p>
              <div className="space-y-1.5">
                {expenses.topCategories.slice(0, 5).map((c) => (
                  <div
                    key={c.category}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-gray-600 truncate max-w-[60%]">
                      {c.category}
                    </span>
                    <span className="text-gray-500 font-medium">
                      {c.pctOfRevenue.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Reconciliation Health */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-500">
            Reconciliation Health
          </h3>
          <a
            href="/reconciliation"
            className="text-xs text-indigo-600 hover:text-indigo-700"
          >
            View Details &rarr;
          </a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400">Reconciliation Rate</p>
            <p
              className={`text-xl font-bold ${
                reconciliation.reconciliationRate >= 80
                  ? "text-emerald-600"
                  : reconciliation.reconciliationRate >= 50
                    ? "text-amber-600"
                    : "text-red-600"
              }`}
            >
              {reconciliation.reconciliationRate}%
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400">Reconciled Payouts</p>
            <p className="text-xl font-bold text-gray-800">
              {reconciliation.reconciledPayouts} /{" "}
              {reconciliation.totalPayouts}
            </p>
          </div>
          <div
            className={`rounded-lg p-3 ${
              reconciliation.alertCounts.error > 0
                ? "bg-red-50"
                : "bg-gray-50"
            }`}
          >
            <p className="text-xs text-gray-400">Error Alerts</p>
            <p
              className={`text-xl font-bold ${
                reconciliation.alertCounts.error > 0
                  ? "text-red-600"
                  : "text-gray-400"
              }`}
            >
              {reconciliation.alertCounts.error}
            </p>
          </div>
          <div
            className={`rounded-lg p-3 ${
              reconciliation.alertCounts.warning > 0
                ? "bg-amber-50"
                : "bg-gray-50"
            }`}
          >
            <p className="text-xs text-gray-400">Warning Alerts</p>
            <p
              className={`text-xl font-bold ${
                reconciliation.alertCounts.warning > 0
                  ? "text-amber-600"
                  : "text-gray-400"
              }`}
            >
              {reconciliation.alertCounts.warning}
            </p>
          </div>
        </div>
        {reconciliation.recentAlerts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 mb-2">
              Recent Unresolved Alerts
            </p>
            {reconciliation.recentAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-lg text-sm ${
                  alert.severity === "error"
                    ? "bg-red-50"
                    : alert.severity === "warning"
                      ? "bg-amber-50"
                      : "bg-blue-50"
                }`}
              >
                <span
                  className={`text-xs font-medium px-1.5 py-0.5 rounded ${severityBadgeClass(
                    alert.severity
                  )}`}
                >
                  {alert.severity}
                </span>
                <div>
                  <p className="text-gray-800">{alert.message}</p>
                  {alert.platform && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {PLATFORM_LABELS[alert.platform] || alert.platform}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 6: Key Insights */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6">
        <h3 className="text-sm font-medium text-indigo-700 mb-4">
          Key Insights
        </h3>
        {insights.length === 0 ? (
          <p className="text-sm text-indigo-400">
            No significant signals detected.
          </p>
        ) : (
          <ul className="space-y-2">
            {insights.map((insight, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-indigo-900"
              >
                <span className="text-indigo-400 mt-0.5 shrink-0">
                  &bull;
                </span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
