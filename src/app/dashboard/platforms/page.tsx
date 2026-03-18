"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import PlatformFilter from "@/components/layout/PlatformFilter";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square (In-Store)",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
};

const PLATFORM_COLORS: Record<string, string> = {
  square: "#006aff",
  doordash: "#ff3008",
  ubereats: "#06c167",
  grubhub: "#ff8b00",
};

interface PlatformStats {
  platform: string;
  orderCount: number;
  grossRevenue: number;
  totalFees: number;
  netPayout: number;
  commissionRate: number;
  avgOrderValue: number;
  avgNetPayout: number;
  tips: number;
}

interface PlatformData {
  platforms: PlatformStats[];
  dailyOrders: {
    date: string;
    platform: string;
    orders: number;
    revenue: number;
  }[];
}

export default function PlatformsPage() {
  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<PlatformData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (data) setRefreshing(true);
    else setInitialLoading(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    fetch(`/api/dashboard/platforms?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const filtered = useMemo(
    () => {
      const platforms = data?.platforms || [];
      return selectedPlatforms.length === 0
        ? platforms
        : platforms.filter((p) => selectedPlatforms.includes(p.platform));
    },
    [data?.platforms, selectedPlatforms]
  );

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data || data.platforms.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No platform order data yet</p>
        <p className="mt-2">
          Import data from DoorDash, Uber Eats, Grubhub, or Square to see
          platform analytics.
        </p>
      </div>
    );
  }
  /* PlatformNav is rendered by the shared layout */

  // Find best platform by net payout
  const bestPlatform = [...filtered].sort(
    (a, b) => b.netPayout - a.netPayout
  )[0];

  // Find most efficient (lowest commission rate)
  const mostEfficient = [...filtered].sort(
    (a, b) => a.commissionRate - b.commissionRate
  )[0];

  return (
    <div className={`transition-opacity duration-150 ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
      <PlatformFilter selected={selectedPlatforms} onChange={setSelectedPlatforms} />

      {/* Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Most Revenue"
          value={PLATFORM_LABELS[bestPlatform.platform] || bestPlatform.platform}
          subtitle={formatCurrency(bestPlatform.netPayout)}
          variant="success"
        />
        <StatCard
          title="Lowest Commission"
          value={
            PLATFORM_LABELS[mostEfficient.platform] || mostEfficient.platform
          }
          subtitle={`${mostEfficient.commissionRate}% commission rate`}
          variant="success"
        />
        <StatCard
          title="Total Orders"
          value={filtered
            .reduce((s, p) => s + p.orderCount, 0)
            .toLocaleString()}
          subtitle={`Across ${filtered.length} platform${filtered.length !== 1 ? "s" : ""}`}
        />
      </div>

      {/* Comparison Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChartCard
          title="Net Payout by Platform"
          showPercentToggle
          data={filtered.map((p) => ({
            name: PLATFORM_LABELS[p.platform] || p.platform,
            value: p.netPayout,
            color: PLATFORM_COLORS[p.platform],
          }))}
        />
        <BarChartCard
          title="Commission Fees by Platform"
          showPercentToggle
          percentValues={filtered.map((p) => p.commissionRate)}
          percentLabel="Commission"
          data={filtered.map((p) => ({
            name: PLATFORM_LABELS[p.platform] || p.platform,
            value: p.totalFees,
            color: PLATFORM_COLORS[p.platform],
          }))}
        />
      </div>

      {/* Platform Comparison Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Platform Comparison
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Platform</th>
                <th className="pb-2 font-medium text-right">Orders</th>
                <th className="pb-2 font-medium text-right">Gross Revenue</th>
                <th className="pb-2 font-medium text-right">Fees</th>
                <th className="pb-2 font-medium text-right">Net Payout</th>
                <th className="pb-2 font-medium text-right">Commission %</th>
                <th className="pb-2 font-medium text-right">Avg Order</th>
                <th className="pb-2 font-medium text-right">Tips</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.platform}
                  className="border-b border-gray-50 cursor-pointer transition-colors hover:bg-gray-50"
                  onClick={() => router.push(`/dashboard/platforms/${p.platform}`)}
                >
                  <td className="py-3 text-gray-800 font-medium">
                    {PLATFORM_LABELS[p.platform] || p.platform}
                  </td>
                  <td className="py-3 text-right text-gray-600">
                    {p.orderCount}
                  </td>
                  <td className="py-3 text-right">
                    {formatCurrency(p.grossRevenue)}
                  </td>
                  <td className="py-3 text-right text-red-600">
                    {formatCurrency(p.totalFees)}
                  </td>
                  <td className="py-3 text-right font-medium text-emerald-600">
                    {formatCurrency(p.netPayout)}
                  </td>
                  <td className="py-3 text-right">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        p.commissionRate <= 15
                          ? "bg-emerald-100 text-emerald-700"
                          : p.commissionRate <= 25
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {p.commissionRate}%
                    </span>
                  </td>
                  <td className="py-3 text-right text-gray-600">
                    {formatCurrency(p.avgOrderValue)}
                  </td>
                  <td className="py-3 text-right text-gray-600">
                    {formatCurrency(p.tips)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
