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
  LineChart,
  Line,
} from "recharts";
import { formatCurrency } from "@/lib/utils/format";
import { linearRegression, movingAverage } from "@/lib/utils/statistics";
import FilterBar, {
  FilterState,
  emptyFilters,
} from "@/components/filters/FilterBar";

type TabKey = "hourly" | "dow" | "fees" | "daily" | "closed";

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
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>("hourly");
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [selectedDow, setSelectedDow] = useState<number | null>(null);
  const [granularity, setGranularity] = useState<number>(60);

  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [dowData, setDowData] = useState<DowData[]>([]);
  const [feeData, setFeeData] = useState<FeeData[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [showDailyTrend, setShowDailyTrend] = useState(false);
  const [showDailyMA, setShowDailyMA] = useState(false);
  const [excludeClosed, setExcludeClosed] = useState(true);
  const [closedDays, setClosedDays] = useState<{ id: string; date: string; reason: string | null; autoDetected: boolean }[]>([]);
  const [detectedDays, setDetectedDays] = useState<{ date: string; dayOfWeek: string }[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addReason, setAddReason] = useState("");

  const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const fetchAnalytics = useCallback(
    async (analyticsType: string, dow?: number | null) => {
      const params = new URLSearchParams({ type: analyticsType });
      if (filters.platforms.length === 1)
        params.set("platform", filters.platforms[0]);
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);
      if (dow !== null && dow !== undefined) params.set("dow", String(dow));
      if (excludeClosed) params.set("excludeClosed", "true");
      if (analyticsType === "revenue_by_hour" && granularity !== 60)
        params.set("granularity", String(granularity));

      const res = await fetch(`/api/analytics?${params.toString()}`);
      return res.json();
    },
    [filters, excludeClosed, granularity]
  );

  useEffect(() => {
    if (tab === "closed") return; // Closed tab has its own fetch
    setLoading(true);
    const map: Record<TabKey, string> = {
      hourly: "revenue_by_hour",
      dow: "revenue_by_dow",
      fees: "fee_analysis",
      daily: "daily_summary",
      closed: "",
    };

    fetchAnalytics(map[tab], tab === "hourly" ? selectedDow : null).then((data) => {
      if (tab === "hourly") setHourlyData(data.hourly || []);
      if (tab === "dow") setDowData(data.byDayOfWeek || []);
      if (tab === "fees") setFeeData(data.feeAnalysis || []);
      if (tab === "daily") setDailyData(data.daily || []);
      setLoading(false);
    });
  }, [tab, filters, selectedDow, excludeClosed, fetchAnalytics]);

  // Fetch closed days when switching to the closed tab
  const fetchClosedDays = useCallback(async (detect = false) => {
    setClosedLoading(true);
    const url = detect ? "/api/closed-days?detect=true" : "/api/closed-days";
    const res = await fetch(url);
    const data = await res.json();
    setClosedDays(
      (data.closedDays || []).map((cd: { id: string; date: string; reason: string | null; autoDetected: boolean }) => ({
        ...cd,
        date: new Date(cd.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
      }))
    );
    if (detect && data.detected) setDetectedDays(data.detected);
    setClosedLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "closed") fetchClosedDays();
  }, [tab, fetchClosedDays]);

  const addClosedDay = async (date: string, reason?: string, autoDetected?: boolean) => {
    await fetch("/api/closed-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, reason, autoDetected }),
    });
    fetchClosedDays();
    setDetectedDays((prev) => prev.filter((d) => d.date !== date));
  };

  const removeClosedDay = async (date: string) => {
    await fetch("/api/closed-days", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    fetchClosedDays();
  };

  const handleFilterChange = useCallback((f: FilterState) => {
    setFilters(f);
  }, []);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "hourly", label: "By Hour" },
    { key: "dow", label: "By Day of Week" },
    { key: "fees", label: "Fee Analysis" },
    { key: "daily", label: "Daily Trend" },
    { key: "closed", label: "Closed Days" },
  ];

  return (
    <div className="space-y-6">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        showTypes={false}
        showCategories={false}
        showSearch={false}
      />

      {/* Tabs + Exclude toggle */}
      <div className="flex items-center gap-4">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              if (t.key !== "hourly") setSelectedDow(null);
              setTab(t.key);
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

        {closedDays.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludeClosed}
              onChange={(e) => setExcludeClosed(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Exclude closed days ({closedDays.length})
          </label>
        )}
      </div>

      {loading && tab !== "closed" ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : (
        <>
          {/* Hourly Revenue */}
          {tab === "hourly" && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-gray-500">
                    Revenue by Time of Day
                  </h3>
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
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
                            ? "bg-white text-indigo-600 shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSelectedDow(null)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      selectedDow === null
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
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
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              <div className={granularity === 60 ? "h-80" : "h-96"}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
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
                      formatter={(value, name) => [
                        formatCurrency(Number(value)),
                        PLATFORM_LABELS[String(name)] || String(name),
                      ]}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    <Legend
                      formatter={(value) => PLATFORM_LABELS[value] || value}
                      iconType="square"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="square" stackId="revenue" fill={PLATFORM_COLORS.square} />
                    <Bar dataKey="doordash" stackId="revenue" fill={PLATFORM_COLORS.doordash} />
                    <Bar dataKey="grubhub" stackId="revenue" fill={PLATFORM_COLORS.grubhub} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Peak hours summary */}
              <div className="mt-4 grid grid-cols-3 gap-4">
                {(() => {
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
                  return (
                    <>
                      <div className="bg-indigo-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Peak Hour</p>
                        <p className="text-lg font-bold text-indigo-600">
                          {peak?.label || "-"}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Total Orders</p>
                        <p className="text-lg font-bold text-gray-800">
                          {totalOrders.toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Total Revenue</p>
                        <p className="text-lg font-bold text-gray-800">
                          {formatCurrency(totalRev)}
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
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">
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
                      formatter={(value, name) => [
                        name === "avgRevenue"
                          ? formatCurrency(Number(value))
                          : Number(value).toFixed(1),
                        name === "avgRevenue" ? "Avg Revenue" : "Avg Orders",
                      ]}
                    />
                    <Bar
                      dataKey="avgRevenue"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Day of week table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
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
                        className="border-b border-gray-50 hover:bg-indigo-50 cursor-pointer transition-colors"
                        onClick={() => { setSelectedDow(d.dow); setTab("hourly"); }}
                      >
                        <td className="py-2 text-gray-800 font-medium">
                          {d.name} <span className="text-indigo-400 text-xs ml-1">→ hourly</span>
                        </td>
                        <td className="py-2 text-right text-gray-600">
                          {formatCurrency(d.avgRevenue)}
                        </td>
                        <td className="py-2 text-right text-gray-600">
                          {d.avgOrders.toFixed(1)}
                        </td>
                        <td className="py-2 text-right text-gray-600">
                          {formatCurrency(d.revenue)}
                        </td>
                        <td className="py-2 text-right text-gray-400">
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
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-4">
                Platform Fee Analysis
              </h3>
              {feeData.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">
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
                        <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => `${v.toFixed(0)}%`}
                          width={50}
                          tickCount={6}
                        />
                        <Tooltip
                          formatter={(value) => [
                            `${Number(value).toFixed(1)}%`,
                            "Fee Rate",
                          ]}
                        />
                        <Bar
                          dataKey="feeRate"
                          fill="#ef4444"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Fee detail table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="pb-2 font-medium">Platform</th>
                          <th className="pb-2 font-medium text-right">
                            Orders
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Revenue
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Commission
                          </th>
                          <th className="pb-2 font-medium text-right">
                            Service Fees
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
                        </tr>
                      </thead>
                      <tbody>
                        {feeData.map((f) => (
                          <tr
                            key={f.platform}
                            className="border-b border-gray-50"
                          >
                            <td className="py-2 text-gray-800 font-medium capitalize">
                              {f.platform}
                            </td>
                            <td className="py-2 text-right text-gray-600">
                              {f.orderCount.toLocaleString()}
                            </td>
                            <td className="py-2 text-right text-gray-600">
                              {formatCurrency(f.totalRevenue)}
                            </td>
                            <td className="py-2 text-right text-red-600">
                              {formatCurrency(f.totalCommissionFee)}
                            </td>
                            <td className="py-2 text-right text-red-600">
                              {formatCurrency(f.totalServiceFee)}
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Closed Days */}
          {tab === "closed" && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-500">
                  Closed Days Management
                </h3>
                <button
                  onClick={() => fetchClosedDays(true)}
                  disabled={closedLoading}
                  className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {closedLoading ? "Detecting..." : "Auto-detect Closed Days"}
                </button>
              </div>

              {/* Auto-detected candidates */}
              {detectedDays.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-amber-700 mb-2">
                    Detected {detectedDays.length} potential closed days
                  </h4>
                  <div className="max-h-64 overflow-y-auto border border-amber-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-amber-50">
                        <tr className="text-left text-gray-500 border-b border-amber-200">
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Day</th>
                          <th className="px-3 py-2 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detectedDays.map((d) => (
                          <tr key={d.date} className="border-b border-amber-100">
                            <td className="px-3 py-2 text-gray-800">{d.date}</td>
                            <td className="px-3 py-2 text-gray-600">{d.dayOfWeek}</td>
                            <td className="px-3 py-2 text-right space-x-2">
                              <button
                                onClick={() => addClosedDay(d.date, undefined, true)}
                                className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDetectedDays((prev) => prev.filter((x) => x.date !== d.date))}
                                className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
                              >
                                Dismiss
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={async () => {
                        for (const d of detectedDays) {
                          await addClosedDay(d.date, undefined, true);
                        }
                        setDetectedDays([]);
                        fetchClosedDays();
                      }}
                      className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                    >
                      Confirm All ({detectedDays.length})
                    </button>
                    <button
                      onClick={() => setDetectedDays([])}
                      className="text-xs px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"
                    >
                      Dismiss All
                    </button>
                  </div>
                </div>
              )}

              {/* Add closed day manually */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Add Closed Day</h4>
                <div className="flex gap-2 items-end">
                  <div>
                    <label className="text-xs text-gray-500">Date</label>
                    <input
                      type="date"
                      value={addDate}
                      onChange={(e) => setAddDate(e.target.value)}
                      className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Reason (optional)</label>
                    <input
                      type="text"
                      value={addReason}
                      onChange={(e) => setAddReason(e.target.value)}
                      placeholder="Holiday, maintenance..."
                      className="block mt-1 w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (addDate) {
                        addClosedDay(addDate, addReason || undefined);
                        setAddDate("");
                        setAddReason("");
                      }
                    }}
                    disabled={!addDate}
                    className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Confirmed closed days */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Confirmed Closed Days ({closedDays.length})
                </h4>
                {closedDays.length === 0 ? (
                  <p className="text-gray-400 text-sm py-4 text-center">
                    No closed days configured. Click &ldquo;Auto-detect&rdquo; to find days with zero income.
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="text-left text-gray-500 border-b">
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Day</th>
                          <th className="px-3 py-2 font-medium">Reason</th>
                          <th className="px-3 py-2 font-medium">Source</th>
                          <th className="px-3 py-2 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closedDays.map((cd) => {
                          const d = new Date(cd.date + "T12:00:00-05:00");
                          return (
                            <tr key={cd.id} className="border-b border-gray-50">
                              <td className="px-3 py-2 text-gray-800">{cd.date}</td>
                              <td className="px-3 py-2 text-gray-600">{DOW_NAMES[d.getDay()]}</td>
                              <td className="px-3 py-2 text-gray-600">{cd.reason || "-"}</td>
                              <td className="px-3 py-2">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${cd.autoDetected ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                                  {cd.autoDetected ? "auto" : "manual"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => removeClosedDay(cd.date)}
                                  className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Daily Trend */}
          {tab === "daily" && (() => {
            // Compute trendline + moving average
            const points = dailyData.map((d, i) => ({ x: i, y: d.revenue }));
            const reg = linearRegression(points);
            const ma = movingAverage(dailyData.map((d) => d.revenue), 7);
            const projectionDays = 14;

            const enrichedDaily = dailyData.map((d, i) => ({
              ...d,
              trend: reg.slope * i + reg.intercept,
              ma: ma[i],
            }));

            // Add projection points
            if (showDailyTrend && dailyData.length > 1) {
              const lastDate = new Date(dailyData[dailyData.length - 1].date);
              for (let j = 1; j <= projectionDays; j++) {
                const futureDate = new Date(lastDate);
                futureDate.setDate(futureDate.getDate() + j);
                const idx = dailyData.length - 1 + j;
                enrichedDaily.push({
                  date: futureDate.toISOString().slice(0, 10),
                  revenue: undefined as unknown as number,
                  count: undefined as unknown as number,
                  avgOrderValue: undefined as unknown as number,
                  trend: reg.slope * idx + reg.intercept,
                  ma: undefined as unknown as number,
                });
              }
            }

            // Format trend label
            const absSlope = Math.abs(reg.slope);
            const trendLabel = absSlope >= 1
              ? `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(0)}/day`
              : `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(2)}/day`;

            return (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-gray-500">
                    Daily Revenue Trend
                  </h3>
                  {showDailyTrend && dailyData.length > 1 && (
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
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setShowDailyTrend((p) => !p)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      showDailyTrend
                        ? "bg-white text-indigo-600 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Trend
                  </button>
                  <button
                    onClick={() => setShowDailyMA((p) => !p)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      showDailyMA
                        ? "bg-white text-indigo-600 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    7d MA
                  </button>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={enrichedDaily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
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
                      formatter={(value, name) => {
                        if (value == null) return ["-", ""];
                        const label =
                          name === "revenue" ? "Revenue"
                            : name === "trend" ? "Trendline"
                            : name === "ma" ? "7d Avg"
                            : name === "avgOrderValue" ? "Avg Order"
                            : "Orders";
                        return [formatCurrency(Number(value)), label];
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
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
                    {(showDailyTrend || showDailyMA) && (
                      <Legend
                        formatter={(value) =>
                          value === "revenue" ? "Revenue"
                            : value === "trend" ? "Trendline"
                            : value === "ma" ? "7-day Avg"
                            : value
                        }
                        iconType="line"
                        wrapperStyle={{ fontSize: 11 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Summary stats */}
              <div className="mt-4 grid grid-cols-4 gap-4">
                {(() => {
                  const totalRev = dailyData.reduce(
                    (s, d) => s + d.revenue,
                    0
                  );
                  const totalDays = dailyData.length;
                  const avgDaily = totalDays > 0 ? totalRev / totalDays : 0;
                  const maxDay = dailyData.reduce(
                    (max, d) => (d.revenue > max.revenue ? d : max),
                    dailyData[0] || { date: "-", revenue: 0 }
                  );
                  return (
                    <>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Total Revenue</p>
                        <p className="text-lg font-bold text-gray-800">
                          {formatCurrency(totalRev)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Avg Daily</p>
                        <p className="text-lg font-bold text-gray-800">
                          {formatCurrency(avgDaily)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Best Day</p>
                        <p className="text-lg font-bold text-emerald-600">
                          {formatCurrency(maxDay.revenue)}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {maxDay.date}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Days Tracked</p>
                        <p className="text-lg font-bold text-gray-800">
                          {totalDays}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
