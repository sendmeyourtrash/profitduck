"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import PlatformPieChart from "@/components/charts/PlatformPieChart";
import BarChartCard from "@/components/charts/BarChartCard";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

interface RevenueData {
  revenueByPlatform: { platform: string; revenue: number; count: number }[];
  dailyRevenue: { date: string; total: number; count: number }[];
  avgOrderByPlatform: {
    platform: string;
    avgSubtotal: number;
    avgNetPayout: number;
    orderCount: number;
  }[];
}

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  chase: "Chase",
  rocketmoney: "Rocket Money",
};

export default function RevenuePage() {
  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    fetch(`/api/dashboard/revenue?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  const totalRevenue = data.revenueByPlatform.reduce(
    (sum, p) => sum + p.revenue,
    0
  );
  const totalOrders = data.revenueByPlatform.reduce(
    (sum, p) => sum + p.count,
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          subtitle={`${totalOrders} transactions`}
        />
        <StatCard
          title="Total Orders"
          value={totalOrders.toLocaleString()}
          subtitle={`${data.avgOrderByPlatform.reduce((s, p) => s + p.orderCount, 0)} platform orders`}
        />
        <StatCard
          title="Avg Order Value"
          value={formatCurrency(
            totalOrders > 0 ? totalRevenue / totalOrders : 0
          )}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart
          data={data.dailyRevenue}
          title="Daily Revenue"
        />
        <PlatformPieChart
          data={data.revenueByPlatform.map((p) => ({
            platform: p.platform,
            revenue: p.revenue,
            orders: p.count,
          }))}
        />
      </div>

      {/* Avg Order by Platform */}
      <BarChartCard
        title="Average Order Value by Platform"
        data={data.avgOrderByPlatform.map((p) => ({
          name: PLATFORM_LABELS[p.platform] || p.platform,
          value: p.avgSubtotal,
        }))}
      />

      {/* Revenue by Platform Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Revenue by Platform
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b">
              <th className="pb-2 font-medium">Platform</th>
              <th className="pb-2 font-medium text-right">Revenue</th>
              <th className="pb-2 font-medium text-right">Orders</th>
              <th className="pb-2 font-medium text-right">Avg Order</th>
              <th className="pb-2 font-medium text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.revenueByPlatform.map((p) => (
              <tr key={p.platform} className="border-b border-gray-50">
                <td className="py-2 text-gray-800">
                  {PLATFORM_LABELS[p.platform] || p.platform}
                </td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(p.revenue)}
                </td>
                <td className="py-2 text-right text-gray-600">{p.count}</td>
                <td className="py-2 text-right text-gray-600">
                  {formatCurrency(p.count > 0 ? p.revenue / p.count : 0)}
                </td>
                <td className="py-2 text-right text-gray-600">
                  {totalRevenue > 0
                    ? ((p.revenue / totalRevenue) * 100).toFixed(1)
                    : 0}
                  %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
