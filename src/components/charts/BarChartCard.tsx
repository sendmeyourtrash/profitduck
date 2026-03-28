"use client";

import { useRef, useState, useEffect } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface BarChartCardProps {
  data: { name: string; value: number; color?: string }[];
  title: string;
  color?: string;
  valuePrefix?: string;
  onBarClick?: (name: string) => void;
  showPercentToggle?: boolean;
  /** When provided, % mode uses these values instead of computing share-of-total */
  percentValues?: number[];
  /** Label shown in tooltip when in % mode (default: "Share") */
  percentLabel?: string;
  /** Label shown in tooltip when in $ mode (default: title) */
  valueLabel?: string;
}

function fmtAxis(v: number, prefix = "$"): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${prefix}${v.toFixed(0)}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

/* Custom Y-axis tick that makes the full row width clickable */
function ClickableYTick({
  x,
  y,
  payload,
  width: tickWidth,
  onBarClick,
  chartWidth,
}: // eslint-disable-next-line @typescript-eslint/no-explicit-any
any & { onBarClick?: (name: string) => void; chartWidth: number }) {
  const label = truncate(payload?.value ?? "", 16);
  return (
    <g
      onClick={() => onBarClick?.(payload?.value)}
      style={{ cursor: onBarClick ? "pointer" : undefined }}
    >
      {/* Invisible hit-area spanning the full row width */}
      <rect
        x={x - tickWidth}
        y={y - 16}
        width={chartWidth}
        height={32}
        fill="transparent"
      />
      <text
        x={x - 4}
        y={y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={11}
        fill="var(--foreground, #666)"
        opacity={0.6}
      >
        {label}
      </text>
    </g>
  );
}

export default function BarChartCard({
  data,
  title,
  color = "#6366f1",
  valuePrefix = "$",
  onBarClick,
  showPercentToggle = false,
  percentValues,
  percentLabel = "Share",
  valueLabel,
}: BarChartCardProps) {
  const { theme } = useTheme();
  const gridStroke = theme === "dark" ? "#374151" : "#e5e7eb";
  const [showPercent, setShowPercent] = useState(false);

  const total = data.reduce((s, d) => s + d.value, 0);
  const chartData = showPercent
    ? percentValues
      ? data.map((d, i) => ({ ...d, value: percentValues[i] ?? 0 }))
      : data.map((d) => ({ ...d, value: total > 0 ? (d.value / total) * 100 : 0 }))
    : data;

  const maxPercent = showPercent
    ? Math.min(100, Math.ceil((Math.max(...chartData.map(d => d.value), 1)) / 5) * 5)
    : undefined;

  const formatValue = (value: number) =>
    showPercent
      ? `${value.toFixed(1)}%`
      : `${valuePrefix}${value.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

  const chartHeight = Math.max(256, data.length * 36);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h3>
        {showPercentToggle && (
          <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 rounded-md p-0.5">
            <button
              onClick={() => setShowPercent(false)}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                !showPercent
                  ? "bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              $
            </button>
            <button
              onClick={() => setShowPercent(true)}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                showPercent
                  ? "bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              %
            </button>
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              type="number"
              tickFormatter={(v) => showPercent ? `${v.toFixed(0)}%` : fmtAxis(v, valuePrefix)}
              tick={{ fontSize: 11 }}
              tickCount={5}
              domain={showPercent ? [0, percentValues ? (maxPercent || 100) : 100] : undefined}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={
                onBarClick
                  ? (props: Record<string, unknown>) => (
                      <ClickableYTick {...props} onBarClick={onBarClick} chartWidth={containerWidth} />
                    )
                  : { fontSize: 11 }
              }
              tickFormatter={onBarClick ? undefined : (v: string) => truncate(v, 16)}
            />
            <Tooltip
              formatter={(value) => [
                formatValue(Number(value)),
                showPercent ? percentLabel : (valueLabel || title),
              ]}
            />
            <Bar
              dataKey="value"
              fill={color}
              radius={[0, 4, 4, 0]}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={
                onBarClick
                  ? (entry) => {
                      const raw = entry as unknown as {
                        payload?: { name: string };
                      };
                      const name = raw.payload?.name;
                      if (name) onBarClick(name);
                    }
                  : undefined
              }
            >
              {chartData.some((d) => d.color) &&
                chartData.map((d, i) => (
                  <Cell key={i} fill={d.color || color} />
                ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
