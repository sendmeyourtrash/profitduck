"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import PlatformPieChart from "@/components/charts/PlatformPieChart";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

interface PeriodStats {
  revenue: number;
  fees: number;
  expenses: number;
  netProfit: number;
}

interface TrendChange { value: number; label: string }
interface OverviewData {
  hasDateRange?: boolean;
  period?: PeriodStats | null;
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  total: PeriodStats;
  platformBreakdown: { platform: string; revenue: number; orders: number }[];
  expensesByCategory?: { category: string; total: number; count: number }[];
  recentTransactions: {
    id: string;
    date: string;
    amount: number;
    type: string;
    sourcePlatform: string;
    description: string;
  }[];
  todayChange?: TrendChange;
  weekChange?: TrendChange;
  monthChange?: TrendChange;
  dailyAvg?: { revenue: number; orders: number; orderValue: number };
  profitMargin?: number;
  expenseRatio?: number;
  cashFlow?: { deposits: number; outflows: number; net: number };
  dayOfWeekRevenue?: { day: string; orders: number; revenue: number }[];
  topItems?: { name: string; qty: number; revenue: number }[];
}

interface RevenueData {
  dailyRevenue: { date: string; total: number; count: number }[];
}

export default function DashboardPage() {
  const { startDate, endDate } = useDateRange();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (overview) setRefreshing(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    Promise.all([
      fetch(`/api/dashboard/overview?${params}`).then((r) => r.json()),
      fetch(`/api/dashboard/revenue?${params}`).then((r) => r.json()),
    ])
      .then(([ov, rev]) => {
        setOverview(ov);
        setRevenueData(rev);
      })
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No data yet</p>
        <p className="mt-2">Import your first file to see dashboard analytics.</p>
      </div>
    );
  }

  // Pick the active period stats
  const ps = overview.hasDateRange && overview.period ? overview.period : overview.month;
  const periodLabel = overview.hasDateRange ? "Selected Period" : "This Month";
  const trendProp = overview.hasDateRange ? undefined : overview.monthChange;

  return (
    <div className={`space-y-5 transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>

      {/* ── ZONE 1: How are we doing? ──────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title={`${periodLabel} Revenue`}
          value={formatCurrency(ps.revenue)}
          subtitle={`Fees: ${formatCurrency(ps.fees)}`}
          trend={trendProp}
        />
        <StatCard
          title="Net Profit"
          value={formatCurrency(ps.netProfit)}
          variant={ps.netProfit >= 0 ? "success" : "danger"}
          subtitle={`Revenue - Fees - Expenses`}
        />
        <StatCard
          title="Profit Margin"
          value={`${overview.profitMargin?.toFixed(1) ?? 0}%`}
          variant={(overview.profitMargin ?? 0) >= 10 ? "success" : (overview.profitMargin ?? 0) >= 0 ? "warning" : "danger"}
          subtitle="All-time margin"
        />
        <StatCard
          title="Avg Order"
          value={formatCurrency(overview.dailyAvg?.orderValue ?? 0)}
          subtitle={`${overview.dailyAvg?.orders ?? 0} orders/day`}
        />
      </div>

      {/* ── ZONE 2: Revenue Trend + Top Items ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <RevenueChart
            data={revenueData?.dailyRevenue || []}
            title="Revenue Trend"
          />
        </div>

        {/* Top Selling Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Top Sellers</h3>
          {overview.topItems && overview.topItems.length > 0 ? (
            <div className="space-y-2.5">
              {overview.topItems.map((item, i) => {
                const maxRev = overview.topItems![0].revenue;
                const pct = maxRev > 0 ? (item.revenue / maxRev) * 100 : 0;
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">
                        <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                        {item.name}
                      </span>
                      <span className="text-gray-800 font-medium ml-2 whitespace-nowrap">
                        {formatCurrency(item.revenue)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{item.qty.toLocaleString()} sold</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No item data available</p>
          )}
        </div>
      </div>

      {/* ── ZONE 3: Busiest Days + Top Expenses ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Busiest Days */}
        {overview.dayOfWeekRevenue && overview.dayOfWeekRevenue.length > 0 && (() => {
          const sorted = [...overview.dayOfWeekRevenue!].sort((a, b) => b.revenue - a.revenue);
          const maxRev = sorted[0]?.revenue || 1;
          return (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Busiest Days</h3>
              <div className="space-y-2">
                {sorted.map((d) => {
                  const pct = (d.revenue / maxRev) * 100;
                  const isBusiest = d.revenue === maxRev;
                  return (
                    <div key={d.day} className="flex items-center gap-2.5">
                      <span className={`text-xs font-semibold w-7 ${isBusiest ? "text-emerald-600" : "text-gray-500"}`}>
                        {d.day}
                      </span>
                      <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                        <div
                          className={`h-full rounded ${isBusiest ? "bg-emerald-400" : "bg-indigo-200"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium w-16 text-right ${isBusiest ? "text-emerald-600" : "text-gray-600"}`}>
                        {formatCurrency(d.revenue)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Top Expense Categories */}
        {overview.expensesByCategory && overview.expensesByCategory.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-500">Top Expenses</h3>
              <a href="/dashboard/expenses" className="text-xs text-indigo-600 hover:text-indigo-700">
                View All &rarr;
              </a>
            </div>
            <div className="space-y-2">
              {overview.expensesByCategory.slice(0, 6).map((cat) => {
                const maxExp = overview.expensesByCategory![0].total;
                const pct = maxExp > 0 ? (cat.total / maxExp) * 100 : 0;
                return (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{cat.category}</span>
                      <span className="text-gray-600 font-medium ml-2">{formatCurrency(cat.total)}</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-red-300 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── ZONE 4: Cash Flow + Platform Revenue + Quick Stats ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Cash Flow */}
        {overview.cashFlow && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Cash Flow</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Deposits In</span>
                <span className="text-sm font-semibold text-emerald-600">{formatCurrency(overview.cashFlow.deposits)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Cash Out</span>
                <span className="text-sm font-semibold text-red-600">{formatCurrency(overview.cashFlow.outflows)}</span>
              </div>
              <div className="border-t border-gray-100 pt-2 flex justify-between items-center">
                <span className="text-sm font-medium text-gray-800">Net Cash Flow</span>
                <span className={`text-sm font-bold ${overview.cashFlow.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {formatCurrency(overview.cashFlow.net)}
                </span>
              </div>
              {overview.expenseRatio != null && (
                <div className="border-t border-gray-100 pt-2 flex justify-between items-center">
                  <span className="text-xs text-gray-400">Expense Ratio</span>
                  <span className={`text-xs font-medium ${(overview.expenseRatio ?? 0) <= 85 ? "text-emerald-600" : "text-red-600"}`}>
                    {overview.expenseRatio.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Platform Revenue — compact bars instead of pie chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Platform Revenue</h3>
          {(() => {
            const PLAT_LABELS: Record<string, string> = { square: "Square", doordash: "DoorDash", ubereats: "Uber Eats", grubhub: "Grubhub" };
            const PLAT_COLORS: Record<string, string> = { square: "bg-indigo-400", doordash: "bg-amber-400", ubereats: "bg-emerald-400", grubhub: "bg-red-400" };
            const totalRev = overview.platformBreakdown.reduce((s, p) => s + p.revenue, 0);
            const sorted = [...overview.platformBreakdown].sort((a, b) => b.revenue - a.revenue);
            return (
              <div className="space-y-2.5">
                {sorted.map((p) => {
                  const pct = totalRev > 0 ? (p.revenue / totalRev) * 100 : 0;
                  return (
                    <div key={p.platform}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{PLAT_LABELS[p.platform] || p.platform}</span>
                        <span className="text-gray-600 font-medium">{formatCurrency(p.revenue)} <span className="text-gray-400 text-xs">({pct.toFixed(0)}%)</span></span>
                      </div>
                      <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${PLAT_COLORS[p.platform] || "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{p.orders.toLocaleString()} orders</p>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Today + This Week snapshot */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Quick Snapshot</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Today</span>
                <span className="text-sm font-semibold text-gray-800">{formatCurrency(overview.today.revenue)}</span>
              </div>
              {overview.todayChange && (
                <p className={`text-[10px] text-right ${overview.todayChange.value >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {overview.todayChange.value >= 0 ? "\u2191" : "\u2193"} {Math.abs(overview.todayChange.value)}% {overview.todayChange.label}
                </p>
              )}
            </div>
            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">This Week</span>
                <span className="text-sm font-semibold text-gray-800">{formatCurrency(overview.week.revenue)}</span>
              </div>
              {overview.weekChange && (
                <p className={`text-[10px] text-right ${overview.weekChange.value >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  {overview.weekChange.value >= 0 ? "\u2191" : "\u2193"} {Math.abs(overview.weekChange.value)}% {overview.weekChange.label}
                </p>
              )}
            </div>
            <div className="border-t border-gray-100 pt-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Avg Daily</span>
                <span className="text-sm font-semibold text-gray-800">{formatCurrency(overview.dailyAvg?.revenue ?? 0)}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Revenue</span>
                <span className="text-sm font-semibold text-gray-800">{formatCurrency(overview.total.revenue)}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Expenses</span>
                <span className="text-sm font-semibold text-red-600">{formatCurrency(overview.total.expenses)}</span>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-800">All-Time Profit</span>
                <span className={`text-sm font-bold ${overview.total.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {formatCurrency(overview.total.netProfit)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
