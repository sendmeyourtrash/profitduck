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

export default function RevenueChart({
  data,
  title = "Revenue Trend",
  showControls = true,
  projectionDays = 14,
  seasonalProjectionPoints,
  seasonalOn = false,
  onSeasonalToggle,
}: RevenueChartProps) {
  const [showTrend, setShowTrend] = useState(false);
  const [showMA, setShowMA] = useState(false);

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

  const fmtAxis = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return `$${v.toFixed(0)}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const { chartData, trendSlope, trendLabel } = useMemo(() => {
    if (data.length === 0)
      return { chartData: [], trendSlope: 0, trendLabel: "" };

    // Compute regression
    const points = data.map((d, i) => ({ x: i, y: d.total }));
    const reg = linearRegression(points);

    // Compute 7-day moving average
    const ma = movingAverage(
      data.map((d) => d.total),
      7
    );

    // Build chart data with trend + MA fields
    const enriched: Record<string, unknown>[] = data.map((d, i) => ({
      ...d,
      trend: reg.slope * i + reg.intercept,
      ma: ma[i],
    }));

    // Add projection points when trend or seasonal is active
    if ((showTrend || seasonalOn) && projectionDays > 0) {
      const lastDate = new Date(data[data.length - 1].date);
      for (let j = 1; j <= projectionDays; j++) {
        const futureDate = new Date(lastDate);
        futureDate.setDate(futureDate.getDate() + j);
        const dateStr = futureDate.toISOString().slice(0, 10);
        const idx = data.length - 1 + j;
        enriched.push({
          date: dateStr,
          total: undefined,
          trend: reg.slope * idx + reg.intercept,
          ma: undefined,
        });
      }
    }

    // Merge seasonal projection points into the enriched data
    if (
      seasonalOn &&
      seasonalProjectionPoints &&
      seasonalProjectionPoints.length > 0
    ) {
      const dataEnd = data.length; // index of first projection point
      for (let i = dataEnd; i < enriched.length; i++) {
        const sp = seasonalProjectionPoints[i - dataEnd];
        if (sp) {
          enriched[i] = { ...enriched[i], seasonal: sp.seasonal };
        }
      }
    }

    // Format trend label
    const absSlope = Math.abs(reg.slope);
    let label = "";
    if (absSlope >= 1) {
      label = `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(0)}/day`;
    } else {
      label = `${reg.slope >= 0 ? "+" : "-"}$${absSlope.toFixed(2)}/day`;
    }

    return { chartData: enriched, trendSlope: reg.slope, trendLabel: label };
  }, [data, showTrend, projectionDays, seasonalOn, seasonalProjectionPoints]);

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
              7d MA
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
              tickFormatter={formatDate}
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
                        ? "7d Avg"
                        : name === "seasonal"
                          ? "Seasonal Forecast"
                          : String(name);
                return [formatCurrency(Number(value)), label];
              }}
              labelFormatter={(label) => formatDate(String(label))}
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
                        ? "7-day Avg"
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
