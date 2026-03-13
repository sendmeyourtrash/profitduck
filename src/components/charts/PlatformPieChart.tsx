"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const COLORS = ["#6366f1", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899"];

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square (In-Store)",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  chase: "Chase",
  rocketmoney: "Rocket Money",
};

interface PlatformData {
  platform: string;
  revenue: number;
  orders?: number;
}

interface PlatformPieChartProps {
  data: PlatformData[];
  title?: string;
}

export default function PlatformPieChart({
  data,
  title = "Revenue by Platform",
}: PlatformPieChartProps) {
  const chartData = data.map((d) => ({
    name: PLATFORM_LABELS[d.platform] || d.platform,
    value: d.revenue,
    orders: d.orders,
  }));

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-4">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatCurrency(Number(value))}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
