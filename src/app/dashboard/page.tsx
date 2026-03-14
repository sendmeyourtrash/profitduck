"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import PlatformPieChart from "@/components/charts/PlatformPieChart";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

interface OverviewData {
  today: { revenue: number; fees: number; expenses: number; netProfit: number };
  week: { revenue: number; fees: number; expenses: number; netProfit: number };
  month: { revenue: number; fees: number; expenses: number; netProfit: number };
  total: { revenue: number; fees: number; expenses: number; netProfit: number };
  platformBreakdown: { platform: string; revenue: number; orders: number }[];
  recentTransactions: {
    id: string;
    date: string;
    amount: number;
    type: string;
    sourcePlatform: string;
    description: string;
  }[];
}

interface RevenueData {
  dailyRevenue: { date: string; total: number; count: number }[];
}

export default function DashboardPage() {
  const { startDate, endDate } = useDateRange();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  const [reconSummary, setReconSummary] = useState<{
    reconciledChains: number;
    discrepancyChains: number;
    activeAlerts: number;
    totalPayoutAmount: number;
    totalBankDeposits: number;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    Promise.all([
      fetch("/api/dashboard/overview").then((r) => r.json()),
      fetch(`/api/dashboard/revenue?${params}`).then((r) => r.json()),
      fetch("/api/reconciliation/chains").then((r) => r.json()).catch(() => null),
    ])
      .then(([ov, rev, recon]) => {
        setOverview(ov);
        setRevenueData(rev);
        if (recon?.summary) setReconSummary(recon.summary);
      })
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  if (loading) {
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
        <p className="mt-2">
          Import your first file to see dashboard analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today Revenue"
          value={formatCurrency(overview.today.revenue)}
          subtitle={`Net: ${formatCurrency(overview.today.netProfit)}`}
        />
        <StatCard
          title="This Week"
          value={formatCurrency(overview.week.revenue)}
          subtitle={`Net: ${formatCurrency(overview.week.netProfit)}`}
        />
        <StatCard
          title="This Month"
          value={formatCurrency(overview.month.revenue)}
          subtitle={`Net: ${formatCurrency(overview.month.netProfit)}`}
        />
        <StatCard
          title="Net Profit (Month)"
          value={formatCurrency(overview.month.netProfit)}
          variant={overview.month.netProfit >= 0 ? "success" : "danger"}
          subtitle={`Fees: ${formatCurrency(overview.month.fees)} | Expenses: ${formatCurrency(overview.month.expenses)}`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart
          data={revenueData?.dailyRevenue || []}
          title="Daily Revenue"
        />
        <PlatformPieChart
          data={overview.platformBreakdown}
          title="Revenue by Platform"
        />
      </div>

      {/* All-Time Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Revenue"
          value={formatCurrency(overview.total.revenue)}
        />
        <StatCard
          title="Total Fees"
          value={formatCurrency(overview.total.fees)}
          variant="warning"
        />
        <StatCard
          title="Total Expenses"
          value={formatCurrency(overview.total.expenses)}
          variant="danger"
        />
        <StatCard
          title="Total Net Profit"
          value={formatCurrency(overview.total.netProfit)}
          variant={overview.total.netProfit >= 0 ? "success" : "danger"}
        />
      </div>

      {/* Reconciliation Status */}
      {reconSummary && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">
              Reconciliation Status
            </h3>
            <a
              href="/reconciliation"
              className="text-xs text-indigo-600 hover:text-indigo-700"
            >
              View Details →
            </a>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-400">Reconciled Chains</p>
              <p className="text-lg font-bold text-emerald-600">
                {reconSummary.reconciledChains}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Discrepancies</p>
              <p className={`text-lg font-bold ${reconSummary.discrepancyChains > 0 ? "text-red-600" : "text-gray-400"}`}>
                {reconSummary.discrepancyChains}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Active Alerts</p>
              <p className={`text-lg font-bold ${reconSummary.activeAlerts > 0 ? "text-amber-600" : "text-gray-400"}`}>
                {reconSummary.activeAlerts}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Recent Transactions
        </h3>
        {overview.recentTransactions.length === 0 ? (
          <p className="text-gray-400 text-sm">No transactions yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 font-medium">Platform</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-50">
                    <td className="py-2 text-gray-600">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-gray-800">
                      {tx.description || "-"}
                    </td>
                    <td className="py-2">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                        {tx.sourcePlatform}
                      </span>
                    </td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          tx.type === "income"
                            ? "bg-emerald-100 text-emerald-700"
                            : tx.type === "fee"
                              ? "bg-amber-100 text-amber-700"
                              : tx.type === "expense"
                                ? "bg-red-100 text-red-700"
                                : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td
                      className={`py-2 text-right font-medium ${
                        tx.type === "income"
                          ? "text-emerald-600"
                          : "text-gray-800"
                      }`}
                    >
                      {formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
