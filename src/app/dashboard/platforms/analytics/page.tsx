"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Area,
  Cell,
} from "recharts";
import { formatCurrency } from "@/lib/utils/format";
import { linearRegression, movingAverage } from "@/lib/utils/statistics";
import PlatformFilter from "@/components/layout/PlatformFilter";
import { useDateRange } from "@/contexts/DateRangeContext";

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type TabKey = "hourly" | "dow" | "fees" | "daily";

/** Smart Y-axis formatter: $1.2M, $45K, $900, etc. */
function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `$${v.toFixed(0)}`;
}

interface HourlyData {
  slot: number;
  hour: number;
  minute: number;
  label: string;
  orderCount: number;
  revenue: number;
  avgOrderValue: number;
  square: number;
  doordash: number;
  grubhub: number;
  ubereats: number;
}

const PLATFORM_COLORS: Record<string, string> = {
  square: "#006aff",
  doordash: "#ff3008",
  grubhub: "#ff8b00",
  ubereats: "#06c167",
};

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  grubhub: "GrubHub",
  ubereats: "UberEats",
};

interface DowData {
  dow: number;
  name: string;
  shortName: string;
  orderCount: number;
  revenue: number;
  avgRevenue: number;
  avgOrders: number;
  daysInSample: number;
  square: number;
  doordash: number;
  grubhub: number;
  ubereats: number;
}

interface FeeData {
  platform: string;
  orderCount: number;
  totalRevenue: number;
  totalDeliveryFee: number;
  totalServiceFee: number;
  totalCommissionFee: number;
  totalTips: number;
  totalNetPayout: number;
  totalFees: number;
  feeRate: number;
}

interface DailyData {
  date: string;
  revenue: number;
  count: number;
  avgOrderValue: number;
  square: number;
  doordash: number;
  grubhub: number;
  ubereats: number;
}

export default function AnalyticsPage() {
  const { startDate: globalStart, endDate: globalEnd } = useDateRange();
  const [tab, setTab] = useState<TabKey>("hourly");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDow, setSelectedDow] = useState<number | null>(null);
  const [granularity, setGranularity] = useState<number>(60);

  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [hourlyDaysInSample, setHourlyDaysInSample] = useState(1);
  const [hourlyShowAvg, setHourlyShowAvg] = useState(false);
  const [dowData, setDowData] = useState<DowData[]>([]);
  const [feeData, setFeeData] = useState<FeeData[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [showDailyTrend, setShowDailyTrend] = useState(false);
  const [showDailyMA, setShowDailyMA] = useState(false);
  const [dailyPeriod, setDailyPeriod] = useState<"1D" | "1W" | "1M" | "1Q">("1D");


  const fetchAnalytics = useCallback(
    async (analyticsType: string, dow?: number | null) => {
      const params = new URLSearchParams({ type: analyticsType });
      if (selectedPlatforms.length > 0)
        params.set("platforms", selectedPlatforms.join(","));
      if (globalStart) params.set("startDate", globalStart);
      if (globalEnd) params.set("endDate", globalEnd);
      if (dow !== null && dow !== undefined) params.set("dow", String(dow));

      if (analyticsType === "revenue_by_hour" && granularity !== 60)
        params.set("granularity", String(granularity));

      const res = await fetch(`/api/analytics?${params.toString()}`);
      return res.json();
    },
    [selectedPlatforms, globalStart, globalEnd, granularity]
  );

  // Prefetch all tabs in parallel for instant tab switching
  useEffect(() => {
    const hasData = hourlyData.length > 0 || dowData.length > 0 || feeData.length > 0 || dailyData.length > 0;
    if (hasData) setRefreshing(true);
    else setInitialLoading(true);

    const fetches = [
      fetchAnalytics("revenue_by_hour", selectedDow).then((data) => {
        setHourlyData(data.hourly || []);
        setHourlyDaysInSample(data.daysInSample || 1);
      }),
      fetchAnalytics("revenue_by_dow").then((data) => {
        setDowData(data.byDayOfWeek || []);
      }),
      fetchAnalytics("fee_analysis").then((data) => {
        setFeeData(data.feeAnalysis || []);
      }),
      fetchAnalytics("daily_summary").then((data) => {
        setDailyData(data.daily || []);
      }),
    ];

    Promise.all(fetches).then(() => { setInitialLoading(false); setRefreshing(false); });
  }, [selectedPlatforms, globalStart, globalEnd, selectedDow, fetchAnalytics]);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "hourly", label: "By Hour" },
    { key: "dow", label: "By Day of Week" },
    { key: "fees", label: "Fee Analysis" },
    { key: "daily", label: "Daily Trend" },
  ];

  return (
    <div className="space-y-6">
      <PlatformFilter selected={selectedPlatforms} onChange={setSelectedPlatforms} />

      {/* Tabs + Exclude toggle */}
      <div className="flex items-center gap-4 overflow-x-auto scrollbar-hide">
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg w-fit shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              if (t.key !== "hourly") setSelectedDow(null);
              setTab(t.key);
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? "bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      </div>

      {/* Full spinner only on very first load (no data yet) */}
      {initialLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : (
        <div className={`transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
          {/* Hourly Revenue */}
          {tab === "hourly" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
              {(selectedPlatforms.length === 0 || selectedPlatforms.includes("ubereats")) && (
                <div className="mb-4 flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2">
                  <span className="text-amber-500 text-sm">⚠</span>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Uber Eats data does not include order times and is excluded from this chart.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-gray-500">
                    {hourlyShowAvg ? "Avg Daily " : ""}Revenue by Time of Day
                  </h3>
                  <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    {[
                      { value: 60, label: "1hr" },
                      { value: 30, label: "30m" },
                      { value: 15, label: "15m" },
                    ].map((g) => (
                      <button
                        key={g.value}
                        onClick={() => setGranularity(g.value)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          granularity === g.value
                            ? "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-400 shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setHourlyShowAvg((p) => !p)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      hourlyShowAvg
                        ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 shadow-sm"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    }`}
                  >
                    Avg{hourlyShowAvg ? ` (${hourlyDaysInSample}d)` : ""}
                  </button>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSelectedDow(null)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      selectedDow === null
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}
                  >
                    All
                  </button>
                  {DOW_NAMES.map((name, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedDow(i)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        selectedDow === i
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                const divisor = hourlyShowAvg ? hourlyDaysInSample : 1;
                const chartData = divisor === 1
                  ? hourlyData
                  : hourlyData.map((h) => ({
                      ...h,
                      revenue: h.revenue / divisor,
                      orderCount: Math.round((h.orderCount / divisor) * 10) / 10,
                      square: h.square / divisor,
                      doordash: h.doordash / divisor,
                      grubhub: h.grubhub / divisor,
                      ubereats: h.ubereats / divisor,
                    }));
                return (
              <div className={granularity === 60 ? "h-80" : "h-96"}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: granularity === 60 ? 11 : 9 }}
                      interval={granularity === 15 ? 3 : granularity === 30 ? 1 : 0}
                      angle={granularity < 60 ? -45 : 0}
                      textAnchor={granularity < 60 ? "end" : "middle"}
                      height={granularity < 60 ? 50 : 30}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={fmtAxis}
                      width={60}
                      tickCount={6}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as HourlyData | undefined;
                        const visiblePayload = payload.filter((p) => {
                          const key = String(p.dataKey);
                          return selectedPlatforms.length === 0 || selectedPlatforms.includes(key);
                        });
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
                            <p className="font-medium text-gray-800 dark:text-gray-200 mb-1.5">Time: {label}</p>
                            {visiblePayload.map((p) => (
                                <div key={String(p.dataKey)} className="flex justify-between gap-4">
                                  <span style={{ color: String(p.color) }}>
                                    {PLATFORM_LABELS[String(p.dataKey)] || String(p.dataKey)}
                                  </span>
                                  <span className="font-medium text-gray-800 dark:text-gray-200">{formatCurrency(Number(p.value))}</span>
                                </div>
                              ))}
                            {row && (
                              <>
                                <div className="border-t border-gray-100 dark:border-gray-700 mt-1.5 pt-1.5 flex justify-between gap-4">
                                  <span className="text-gray-500 dark:text-gray-400">{hourlyShowAvg ? "Avg Orders/Day" : "Orders"}</span>
                                  <span className="font-medium text-gray-800 dark:text-gray-200">{row.orderCount}</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span className="text-gray-500 dark:text-gray-400">Avg Order Value</span>
                                  <span className="font-medium text-amber-600">
                                    {row.orderCount > 0 ? formatCurrency(row.avgOrderValue) : "—"}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      formatter={(value) => PLATFORM_LABELS[value] || value}
                      iconType="square"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    {(selectedPlatforms.length === 0 || selectedPlatforms.includes("doordash")) && (
                      <Bar dataKey="doordash" stackId="revenue" fill={PLATFORM_COLORS.doordash} />
                    )}
                    {(selectedPlatforms.length === 0 || selectedPlatforms.includes("grubhub")) && (
                      <Bar dataKey="grubhub" stackId="revenue" fill={PLATFORM_COLORS.grubhub} />
                    )}
                    {(selectedPlatforms.length === 0 || selectedPlatforms.includes("ubereats")) && (
                      <Bar dataKey="ubereats" stackId="revenue" fill={PLATFORM_COLORS.ubereats} />
                    )}
                    {(selectedPlatforms.length === 0 || selectedPlatforms.includes("square")) && (
                      <Bar dataKey="square" stackId="revenue" fill={PLATFORM_COLORS.square} radius={[2, 2, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
                );
              })()}
              {/* Summary cards */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {(() => {
                  const d = hourlyShowAvg ? hourlyDaysInSample : 1;
                  const sorted = [...hourlyData].sort(
                    (a, b) => b.revenue - a.revenue
                  );
                  const peak = sorted[0];
                  const totalOrders = hourlyData.reduce(
                    (s, h) => s + h.orderCount,
                    0
                  );
                  const totalRev = hourlyData.reduce(
                    (s, h) => s + h.revenue,
                    0
                  );
                  const activeSlots = hourlyData.filter(
                    (h) => h.orderCount > 0
                  ).length;
                  const orders = totalOrders / d;
                  const rev = totalRev / d;
                  const avgOrderValue =
                    totalOrders > 0 ? totalRev / totalOrders : 0;
                  const avgRevPerSlot =
                    activeSlots > 0 ? rev / activeSlots : 0;
                  return (
                    <>
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Peak Hour</p>
                        <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                          {peak?.label || "-"}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {hourlyShowAvg ? "Avg Orders/Day" : "Total Orders"}
                        </p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {hourlyShowAvg ? orders.toFixed(1) : totalOrders.toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {hourlyShowAvg ? "Avg Daily Revenue" : "Total Revenue"}
                        </p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {formatCurrency(rev)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg Order Value</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {formatCurrency(avgOrderValue)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg Revenue/Hour</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {formatCurrency(avgRevPerSlot)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Active Hours</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {activeSlots}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Day of Week */}
          {tab === "dow" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
                Average Daily Revenue by Day of Week
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dowData}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(state: any) => {
                      if (state?.activePayload?.[0]?.payload) {
                        setSelectedDow(state.activePayload[0].payload.dow);
                        setTab("hourly");
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="shortName" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={fmtAxis}
                      width={60}
                      tickCount={6}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as DowData | undefined;
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
                            <p className="font-medium text-gray-800 dark:text-gray-200 mb-1.5">{row?.name || label}</p>
                            {payload.map((p) => (
                              <div key={String(p.dataKey)} className="flex justify-between gap-4">
                                <span style={{ color: String(p.color) }}>
                                  {PLATFORM_LABELS[String(p.dataKey)] || String(p.dataKey)}
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">{formatCurrency(Number(p.value))}</span>
                              </div>
                            ))}
                            {row && (
                              <div className="border-t border-gray-100 dark:border-gray-700 mt-1.5 pt-1.5 flex justify-between gap-4">
                                <span className="text-gray-500 dark:text-gray-400">Avg Orders</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">{row.avgOrders.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      formatter={(value) => PLATFORM_LABELS[value] || value}
                      iconType="square"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="square" stackId="revenue" fill={PLATFORM_COLORS.square} />
                    <Bar dataKey="doordash" stackId="revenue" fill={PLATFORM_COLORS.doordash} />
                    <Bar dataKey="grubhub" stackId="revenue" fill={PLATFORM_COLORS.grubhub} />
                    <Bar dataKey="ubereats" stackId="revenue" fill={PLATFORM_COLORS.ubereats} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Day of week table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                      <th className="pb-2 font-medium">Day</th>
                      <th className="pb-2 font-medium text-right">
                        Avg Revenue
                      </th>
                      <th className="pb-2 font-medium text-right">
                        Avg Orders
                      </th>
                      <th className="pb-2 font-medium text-right">
                        Total Revenue
                      </th>
                      <th className="pb-2 font-medium text-right">
                        Days in Sample
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dowData.map((d) => (
                      <tr
                        key={d.dow}
                        className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer transition-colors"
                        onClick={() => { setSelectedDow(d.dow); setTab("hourly"); }}
                      >
                        <td className="py-2 text-gray-800 dark:text-gray-200 font-medium">
                          {d.name} <span className="text-indigo-400 dark:text-indigo-500 text-xs ml-1">→ hourly</span>
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(d.avgRevenue)}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {d.avgOrders.toFixed(1)}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(d.revenue)}
                        </td>
                        <td className="py-2 text-right text-gray-400 dark:text-gray-500">
                          {d.daysInSample}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Fee Analysis */}
          {tab === "fees" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
                Platform Fee Analysis
              </h3>
              {feeData.length === 0 ? (
                <p className="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
                  No platform order data available
                </p>
              ) : (
                <div className="space-y-6">
                  {/* Fee comparison chart */}
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={feeData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#f0f0f0"
                        />
                        <XAxis
                          dataKey="platform"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(v) => PLATFORM_LABELS[v] || v}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => `${v.toFixed(0)}%`}
                          width={50}
                          tickCount={6}
                        />
                        <Tooltip
                          formatter={(value, _name, props) => [
                            `${Number(value).toFixed(1)}%`,
                            `${PLATFORM_LABELS[props.payload?.platform] || props.payload?.platform} Fee Rate`,
                          ]}
                        />
                        <Bar dataKey="feeRate" radius={[4, 4, 0, 0]}>
                          {feeData.map((f) => (
                            <Cell key={f.platform} fill={PLATFORM_COLORS[f.platform] || "#888"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Fee detail table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                          <th className="pb-2 font-medium">Platform</th>
                          <th className="pb-2 font-medium text-right">
                            Orders
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Revenue
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Total Fees
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Fee Rate
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Net Payout
                          </th>
                          <th className="pb-2 font-medium text-right text-gray-400 dark:text-gray-500">
                            Avg Rev/Order
                          </th>
                          <th className="pb-2 font-medium text-right text-gray-400 dark:text-gray-500">
                            Avg Fee/Order
                          </th>
                          <th className="pb-2 font-medium text-right text-gray-400 dark:text-gray-500">
                            Avg Net/Order
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeData.map((f) => {
                          const avgRev =
                            f.orderCount > 0
                              ? f.totalRevenue / f.orderCount
                              : 0;
                          const avgFee =
                            f.orderCount > 0
                              ? f.totalFees / f.orderCount
                              : 0;
                          const avgNet =
                            f.orderCount > 0
                              ? f.totalNetPayout / f.orderCount
                              : 0;
                          return (
                            <tr
                              key={f.platform}
                              className="border-b border-gray-100 dark:border-gray-700/50"
                            >
                              <td className="py-2 text-gray-800 dark:text-gray-200 font-medium">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PLATFORM_COLORS[f.platform] || "#888" }} />
                                  {PLATFORM_LABELS[f.platform] || f.platform}
                                </span>
                              </td>
                              <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                                {f.orderCount.toLocaleString()}
                              </td>
                              <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                                {formatCurrency(f.totalRevenue)}
                              </td>
                              <td className="py-2 text-right text-red-600 font-medium">
                                {formatCurrency(f.totalFees)}
                              </td>
                              <td className="py-2 text-right font-medium">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs ${
                                    f.feeRate > 25
                                      ? "bg-red-100 text-red-700"
                                      : f.feeRate > 15
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {f.feeRate.toFixed(1)}%
                                </span>
                              </td>
                              <td className="py-2 text-right text-emerald-600 font-medium">
                                {formatCurrency(f.totalNetPayout)}
                              </td>
                              <td className="py-2 text-right text-gray-500 dark:text-gray-400">
                                {formatCurrency(avgRev)}
                              </td>
                              <td className="py-2 text-right text-red-400 dark:text-red-500">
                                {formatCurrency(avgFee)}
                              </td>
                              <td className="py-2 text-right text-emerald-500 dark:text-emerald-400">
                                {formatCurrency(avgNet)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Daily Trend */}
          {tab === "daily" && (() => {
            // Aggregate data by selected period
            const periodLabels = { "1D": "Daily", "1W": "Weekly", "1M": "Monthly", "1Q": "Quarterly" };
            const maWindow = dailyPeriod === "1D" ? 7 : dailyPeriod === "1W" ? 4 : 3;

            function bucketKey(dateStr: string): string {
              const d = new Date(dateStr + "T12:00:00");
              if (dailyPeriod === "1W") {
                // ISO week start (Monday)
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d);
                monday.setDate(diff);
                return monday.toISOString().slice(0, 10);
              }
              if (dailyPeriod === "1M") return dateStr.slice(0, 7); // "2026-03"
              if (dailyPeriod === "1Q") {
                const q = Math.ceil((d.getMonth() + 1) / 3);
                return `${d.getFullYear()}-Q${q}`;
              }
              return dateStr; // 1D
            }

            function bucketLabel(key: string): string {
              if (dailyPeriod === "1W") {
                const d = new Date(key + "T12:00:00");
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              }
              if (dailyPeriod === "1M") {
                const [y, m] = key.split("-");
                const d = new Date(Number(y), Number(m) - 1);
                return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
              }
              if (dailyPeriod === "1Q") return key; // "2026-Q1"
              return key; // 1D: date string
            }

            type AggBucket = { key: string; label: string; revenue: number; count: number; square: number; doordash: number; grubhub: number; ubereats: number };
            const buckets = new Map<string, AggBucket>();
            for (const d of dailyData) {
              const k = bucketKey(d.date);
              let b = buckets.get(k);
              if (!b) { b = { key: k, label: bucketLabel(k), revenue: 0, count: 0, square: 0, doordash: 0, grubhub: 0, ubereats: 0 }; buckets.set(k, b); }
              b.revenue += d.revenue; b.count += d.count;
              b.square += d.square; b.doordash += d.doordash;
              b.grubhub += d.grubhub; b.ubereats += d.ubereats;
            }
            const aggregated = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));

            // Compute trendline + moving average on aggregated data
            const points = aggregated.map((d, i) => ({ x: i, y: d.revenue }));
            const reg = linearRegression(points);
            const ma = movingAverage(aggregated.map((d) => d.revenue), maWindow);
            const projectionCount = dailyPeriod === "1D" ? 14 : dailyPeriod === "1W" ? 4 : dailyPeriod === "1M" ? 3 : 2;

            const enrichedDaily = aggregated.map((d, i) => ({
              ...d,
              avgOrderValue: d.count > 0 ? d.revenue / d.count : 0,
              trend: reg.slope * i + reg.intercept,
              ma: ma[i],
            }));

            // Add projection points
            if (showDailyTrend && aggregated.length > 1) {
              for (let j = 1; j <= projectionCount; j++) {
                const idx = aggregated.length - 1 + j;
                enrichedDaily.push({
                  key: `proj-${j}`,
                  label: "",
                  revenue: undefined as unknown as number,
                  count: undefined as unknown as number,
                  avgOrderValue: undefined as unknown as number,
                  square: undefined as unknown as number,
                  doordash: undefined as unknown as number,
                  grubhub: undefined as unknown as number,
                  ubereats: undefined as unknown as number,
                  trend: reg.slope * idx + reg.intercept,
                  ma: undefined as unknown as number,
                });
              }
            }

            // Format trend label
            const perLabel = dailyPeriod === "1D" ? "day" : dailyPeriod === "1W" ? "wk" : dailyPeriod === "1M" ? "mo" : "qtr";
            const absSlope = Math.abs(reg.slope);
            const trendLabel = absSlope >= 1
              ? `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(0)}/${perLabel}`
              : `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(2)}/${perLabel}`;

            return (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {periodLabels[dailyPeriod]} Revenue Trend
                  </h3>
                  <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    {(["1D", "1W", "1M", "1Q"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setDailyPeriod(p)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          dailyPeriod === p
                            ? "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-400 shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  {showDailyTrend && aggregated.length > 1 && (
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        reg.slope >= 0
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      {trendLabel}
                    </span>
                  )}
                </div>
                <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                  <button
                    onClick={() => setShowDailyTrend((p) => !p)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      showDailyTrend
                        ? "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-400 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    }`}
                  >
                    Trend
                  </button>
                  <button
                    onClick={() => setShowDailyMA((p) => !p)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      showDailyMA
                        ? "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-400 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    }`}
                  >
                    {maWindow}p MA
                  </button>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={enrichedDaily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={fmtAxis}
                      width={60}
                      tickCount={6}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        // Filter out trend/ma for the platform section
                        const platforms = payload.filter((p) =>
                          ["square", "doordash", "grubhub", "ubereats"].includes(String(p.dataKey))
                        );
                        const trendEntry = payload.find((p) => p.dataKey === "trend");
                        const maEntry = payload.find((p) => p.dataKey === "ma");
                        const total = platforms.reduce((s, p) => s + (Number(p.value) || 0), 0);
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
                            <p className="font-medium text-gray-800 dark:text-gray-200 mb-1.5">{label}</p>
                            {platforms.map((p) => (
                              Number(p.value) > 0 ? (
                                <div key={String(p.dataKey)} className="flex justify-between gap-4">
                                  <span style={{ color: String(p.color) }}>
                                    {PLATFORM_LABELS[String(p.dataKey)] || String(p.dataKey)}
                                  </span>
                                  <span className="font-medium text-gray-800 dark:text-gray-200">{formatCurrency(Number(p.value))}</span>
                                </div>
                              ) : null
                            ))}
                            {total > 0 && (
                              <div className="border-t border-gray-100 dark:border-gray-700 mt-1.5 pt-1.5 flex justify-between gap-4">
                                <span className="text-gray-500 dark:text-gray-400">Total</span>
                                <span className="font-bold text-gray-800 dark:text-gray-200">{formatCurrency(total)}</span>
                              </div>
                            )}
                            {trendEntry && trendEntry.value != null && (
                              <div className="flex justify-between gap-4">
                                <span className="text-gray-400 dark:text-gray-500">Trendline</span>
                                <span className="text-gray-500 dark:text-gray-400">{formatCurrency(Number(trendEntry.value))}</span>
                              </div>
                            )}
                            {maEntry && maEntry.value != null && (
                              <div className="flex justify-between gap-4">
                                <span className="text-amber-500">{maWindow}p Avg</span>
                                <span className="text-gray-500">{formatCurrency(Number(maEntry.value))}</span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="square" stackId="revenue" fill={PLATFORM_COLORS.square} stroke={PLATFORM_COLORS.square} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="doordash" stackId="revenue" fill={PLATFORM_COLORS.doordash} stroke={PLATFORM_COLORS.doordash} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="grubhub" stackId="revenue" fill={PLATFORM_COLORS.grubhub} stroke={PLATFORM_COLORS.grubhub} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="ubereats" stackId="revenue" fill={PLATFORM_COLORS.ubereats} stroke={PLATFORM_COLORS.ubereats} fillOpacity={0.7} />
                    {showDailyTrend && (
                      <Line
                        type="monotone"
                        dataKey="trend"
                        stroke="#9ca3af"
                        strokeWidth={2}
                        strokeDasharray="8 4"
                        dot={false}
                        connectNulls
                      />
                    )}
                    {showDailyMA && (
                      <Line
                        type="monotone"
                        dataKey="ma"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="4 2"
                        dot={false}
                        connectNulls={false}
                      />
                    )}
                    <Legend
                      formatter={(value) =>
                        PLATFORM_LABELS[value] || (value === "trend" ? "Trendline" : value === "ma" ? `${maWindow}p Avg` : value)
                      }
                      iconType="square"
                      wrapperStyle={{ fontSize: 11 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Summary stats */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {(() => {
                  const totalRev = aggregated.reduce(
                    (s, d) => s + d.revenue,
                    0
                  );
                  const totalOrders = aggregated.reduce(
                    (s, d) => s + d.count,
                    0
                  );
                  const totalPeriods = aggregated.length;
                  const avgPer = totalPeriods > 0 ? totalRev / totalPeriods : 0;
                  const avgOrderVal =
                    totalOrders > 0 ? totalRev / totalOrders : 0;
                  const avgOrdersPer =
                    totalPeriods > 0 ? totalOrders / totalPeriods : 0;
                  const maxDay = aggregated.reduce(
                    (max, d) => (d.revenue > max.revenue ? d : max),
                    aggregated[0] || { label: "-", revenue: 0 }
                  );
                  return (
                    <>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Total Revenue</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {formatCurrency(totalRev)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg {periodLabels[dailyPeriod]} Revenue</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {formatCurrency(avgPer)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg Order Value</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {formatCurrency(avgOrderVal)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Avg Orders/{periodLabels[dailyPeriod].replace("ly","")}</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {avgOrdersPer.toFixed(1)}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Best Period</p>
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(maxDay.revenue)}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                          {maxDay.label}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Periods</p>
                        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                          {totalPeriods}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
