"use client";

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

export default function BarChartCard({
  data,
  title,
  color = "#6366f1",
  valuePrefix = "$",
  onBarClick,
}: BarChartCardProps) {
  const formatValue = (value: number) =>
    `${valuePrefix}${value.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

  const chartHeight = Math.max(256, data.length * 36);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-4">{title}</h3>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              type="number"
              tickFormatter={(v) => fmtAxis(v, valuePrefix)}
              tick={{ fontSize: 11 }}
              tickCount={5}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11 }}
              width={110}
              tickFormatter={(v) => truncate(v, 16)}
            />
            <Tooltip formatter={(value) => formatValue(Number(value))} />
            <Bar
              dataKey="value"
              fill={color}
              radius={[0, 4, 4, 0]}
              cursor={onBarClick ? "pointer" : undefined}
              onClick={
                onBarClick
                  ? (entry) => {
                      // Recharts wraps the original data in a `payload` property
                      const raw = entry as unknown as {
                        payload?: { name: string };
                      };
                      const name = raw.payload?.name;
                      if (name) onBarClick(name);
                    }
                  : undefined
              }
            >
              {data.some((d) => d.color) &&
                data.map((d, i) => (
                  <Cell key={i} fill={d.color || color} />
                ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
