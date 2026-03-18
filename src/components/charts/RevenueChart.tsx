"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { linearRegression, movingAverage } from "@/lib/utils/statistics";

type Period = "1D" | "1W" | "1M" | "1Q";

interface DataPoint {
  date: string;
  total: number;
  count?: number;
}

interface SeasonalPoint {
  date: string;
  seasonal: number;
}

interface RevenueChartProps {
  data: DataPoint[];
  title?: string;
  showControls?: boolean;
  projectionDays?: number;
  // Seasonal projection (optional — only used on health report page)
  seasonalProjectionPoints?: SeasonalPoint[];
  seasonalOn?: boolean;
  onSeasonalToggle?: (on: boolean) => void;
}

// --- Period bucketing helpers ---

function bucketKey(dateStr: string, period: Period): string {
  if (period === "1D") return dateStr;
  const d = new Date(dateStr + "T12:00:00");
  if (period === "1W") {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }
  if (period === "1M") return dateStr.slice(0, 7);
  // 1Q
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}-Q${q}`;
}

function bucketLabel(key: string, period: Period): string {
  if (period === "1D") {
    const d = new Date(key);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (period === "1W") {
    const d = new Date(key + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (period === "1M") {
    const [y, m] = key.split("-");
    const d = new Date(Number(y), Number(m) - 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return key; // 1Q: "2026-Q1"
}

function aggregateByPeriod(data: DataPoint[], period: Period): { key: string; label: string; total: number; count: number }[] {
  if (period === "1D") return data.map((d) => ({ key: d.date, label: "", total: d.total, count: d.count ?? 0 }));
  const buckets = new Map<string, { key: string; label: string; total: number; count: number }>();
  for (const d of data) {
    const k = bucketKey(d.date, period);
    let b = buckets.get(k);
    if (!b) { b = { key: k, label: bucketLabel(k, period), total: 0, count: 0 }; buckets.set(k, b); }
    b.total += d.total;
    b.count += d.count ?? 0;
  }
  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

const MA_WINDOW: Record<Period, number> = { "1D": 7, "1W": 4, "1M": 3, "1Q": 3 };
const PROJECTION_COUNT: Record<Period, number> = { "1D": 14, "1W": 4, "1M": 3, "1Q": 2 };
const PERIOD_UNIT: Record<Period, string> = { "1D": "day", "1W": "wk", "1M": "mo", "1Q": "qtr" };
const MA_LABEL: Record<Period, string> = { "1D": "7d MA", "1W": "4w MA", "1M": "3m MA", "1Q": "3q MA" };

export default function RevenueChart({
  data,
  title = "Revenue Trend",
  showControls = true,
  projectionDays,
  seasonalProjectionPoints,
  seasonalOn = false,
  onSeasonalToggle,
}: RevenueChartProps) {
  const [showTrend, setShowTrend] = useState(false);
  const [showMA, setShowMA] = useState(false);
  const [period, setPeriod] = useState<Period>("1D");

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

  const fmtAxis = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return `$${v.toFixed(0)}`;
  };

  const formatDateLabel = (dateStr: string) => {
    if (period !== "1D") return dateStr; // already formatted by bucketLabel
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const { chartData, trendSlope, trendLabel } = useMemo(() => {
    if (data.length === 0)
      return { chartData: [], trendSlope: 0, trendLabel: "" };

    // Aggregate data by period
    const aggregated = aggregateByPeriod(data, period);
    const maWindow = MA_WINDOW[period];
    const projCount = projectionDays ?? PROJECTION_COUNT[period];

    // Use label for display, keep key for date arithmetic
    const displayData = aggregated.map((d) => ({
      date: period === "1D" ? d.key : d.label,
      key: d.key,
      total: d.total,
      count: d.count,
    }));

    // Compute regression
    const points = displayData.map((d, i) => ({ x: i, y: d.total }));
    const reg = linearRegression(points);

    // Compute moving average
    const ma = movingAverage(
      displayData.map((d) => d.total),
      maWindow
    );

    // Build chart data with trend + MA fields
    const enriched: Record<string, unknown>[] = displayData.map((d, i) => ({
      ...d,
      trend: reg.slope * i + reg.intercept,
      ma: ma[i],
    }));

    // Add projection points when trend or seasonal is active
    if ((showTrend || seasonalOn) && projCount > 0) {
      const lastKey = displayData.length > 0 ? displayData[displayData.length - 1].key : "";
      for (let j = 1; j <= projCount; j++) {
        const idx = displayData.length - 1 + j;
        let futureLabel = "";
        if (lastKey) {
          // Parse from the sortable key (always YYYY-MM-DD or YYYY-MM or YYYY-Q#)
          const d = period === "1M"
            ? new Date(lastKey + "-01T12:00:00")
            : period === "1Q"
              ? (() => { const [y, q] = lastKey.split("-Q"); return new Date(Number(y), (Number(q) - 1) * 3, 1, 12); })()
              : new Date(lastKey + "T12:00:00");
          if (period === "1D") {
            d.setDate(d.getDate() + j);
            futureLabel = d.toISOString().slice(0, 10);
          } else if (period === "1W") {
            d.setDate(d.getDate() + j * 7);
            futureLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          } else if (period === "1M") {
            d.setMonth(d.getMonth() + j);
            futureLabel = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          } else {
            d.setMonth(d.getMonth() + j * 3);
            futureLabel = `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
          }
        }
        enriched.push({
          date: futureLabel,
          total: undefined,
          trend: reg.slope * idx + reg.intercept,
          ma: undefined,
        });
      }
    }

    // Merge seasonal projection points into the enriched data (only for 1D)
    if (
      period === "1D" &&
      seasonalOn &&
      seasonalProjectionPoints &&
      seasonalProjectionPoints.length > 0
    ) {
      const dataEnd = displayData.length;
      for (let i = dataEnd; i < enriched.length; i++) {
        const sp = seasonalProjectionPoints[i - dataEnd];
        if (sp) {
          enriched[i] = { ...enriched[i], seasonal: sp.seasonal };
        }
      }
    }

    // Format trend label
    const unit = PERIOD_UNIT[period];
    const absSlope = Math.abs(reg.slope);
    const label = absSlope >= 1
      ? `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(0)}/${unit}`
      : `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(2)}/${unit}`;

    return { chartData: enriched, trendSlope: reg.slope, trendLabel: label };
  }, [data, period, showTrend, projectionDays, seasonalOn, seasonalProjectionPoints]);

  const hasOverlay = showTrend || showMA || seasonalOn;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-500">{title}</h3>
          {showTrend && data.length > 1 && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trendSlope >= 0
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {trendLabel}
            </span>
          )}
        </div>
        {showControls && (
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {([["1D", "Daily"], ["1W", "Weekly"], ["1M", "Monthly"], ["1Q", "Quarterly"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    period === key
                      ? "bg-white text-indigo-600 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setShowTrend((p) => !p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  showTrend
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Trend
              </button>
              <button
                onClick={() => setShowMA((p) => !p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  showMA
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {MA_LABEL[period]}
              </button>
              {onSeasonalToggle && (
                <button
                  onClick={() => onSeasonalToggle(!seasonalOn)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    seasonalOn
                      ? "bg-white text-indigo-600 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Seasonal
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              tick={{ fontSize: 12 }}
              stroke="#9ca3af"
            />
            <YAxis
              tickFormatter={fmtAxis}
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
              width={55}
              tickCount={6}
            />
            <Tooltip
              formatter={(value, name) => {
                if (value == null) return ["-", ""];
                const label =
                  name === "total"
                    ? "Revenue"
                    : name === "trend"
                      ? "Trendline"
                      : name === "ma"
                        ? MA_LABEL[period]
                        : name === "seasonal"
                          ? "Seasonal Forecast"
                          : String(name);
                return [formatCurrency(Number(value)), label];
              }}
              labelFormatter={(label) => formatDateLabel(String(label))}
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke="#6366f1"
              fill="url(#colorRevenue)"
              strokeWidth={2}
              connectNulls={false}
            />
            {showTrend && (
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
            {showMA && (
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
            {seasonalOn && onSeasonalToggle && (
              <Line
                type="monotone"
                dataKey="seasonal"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                connectNulls={false}
              />
            )}
            {hasOverlay && (
              <Legend
                formatter={(value) =>
                  value === "total"
                    ? "Revenue"
                    : value === "trend"
                      ? "Trendline"
                      : value === "ma"
                        ? MA_LABEL[period]
                        : value === "seasonal"
                          ? "Seasonal Forecast"
                          : value
                }
                iconType="line"
                wrapperStyle={{ fontSize: 11 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
