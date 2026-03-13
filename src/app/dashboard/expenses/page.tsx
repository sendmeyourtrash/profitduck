"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import RevenueChart from "@/components/charts/RevenueChart";
import { formatCurrency } from "@/lib/utils/format";

interface ExpenseData {
  expensesByVendor: {
    vendorId: string;
    vendorName: string;
    total: number;
    count: number;
  }[];
  expensesByCategory: {
    category: string;
    total: number;
    count: number;
  }[];
  monthlyExpenses: { month: string; total: number }[];
  feesByPlatform: { platform: string; fees: number }[];
}

export default function ExpensesPage() {
  const [data, setData] = useState<ExpenseData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/expenses?days=${days}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  const totalExpenses = data.expensesByVendor.reduce(
    (sum, v) => sum + v.total,
    0
  );
  const totalFees = data.feesByPlatform.reduce((sum, f) => sum + f.fees, 0);

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex gap-2">
        {[7, 30, 90, 365].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              days === d
                ? "bg-indigo-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {d === 7
              ? "7 Days"
              : d === 30
                ? "30 Days"
                : d === 90
                  ? "90 Days"
                  : "1 Year"}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(totalExpenses)}
          variant="danger"
        />
        <StatCard
          title="Platform Fees"
          value={formatCurrency(totalFees)}
          variant="warning"
        />
        <StatCard
          title="Combined Costs"
          value={formatCurrency(totalExpenses + totalFees)}
          variant="danger"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarChartCard
          title="Expenses by Vendor"
          data={data.expensesByVendor.slice(0, 10).map((v) => ({
            name: v.vendorName,
            value: v.total,
          }))}
          color="#ef4444"
        />
        <BarChartCard
          title="Expenses by Category"
          data={data.expensesByCategory.map((c) => ({
            name: c.category,
            value: c.total,
          }))}
          color="#f59e0b"
        />
      </div>

      {/* Monthly Trend */}
      <RevenueChart
        data={data.monthlyExpenses.map((m) => ({
          date: `${m.month}-01`,
          total: m.total,
        }))}
        title="Monthly Expense Trend"
      />

      {/* Platform Fees Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Platform Fees Breakdown
        </h3>
        {data.feesByPlatform.length === 0 ? (
          <p className="text-gray-400 text-sm">No fee data available</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Platform</th>
                <th className="pb-2 font-medium text-right">Total Fees</th>
              </tr>
            </thead>
            <tbody>
              {data.feesByPlatform.map((f) => (
                <tr key={f.platform} className="border-b border-gray-50">
                  <td className="py-2 text-gray-800">{f.platform}</td>
                  <td className="py-2 text-right font-medium text-amber-600">
                    {formatCurrency(f.fees)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Vendor Details Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Top Vendors by Spending
        </h3>
        {data.expensesByVendor.length === 0 ? (
          <p className="text-gray-400 text-sm">No vendor data available</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Vendor</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium text-right">Transactions</th>
                <th className="pb-2 font-medium text-right">Avg</th>
              </tr>
            </thead>
            <tbody>
              {data.expensesByVendor.map((v) => (
                <tr key={v.vendorId} className="border-b border-gray-50">
                  <td className="py-2 text-gray-800">{v.vendorName}</td>
                  <td className="py-2 text-right font-medium text-red-600">
                    {formatCurrency(v.total)}
                  </td>
                  <td className="py-2 text-right text-gray-600">{v.count}</td>
                  <td className="py-2 text-right text-gray-600">
                    {formatCurrency(v.count > 0 ? v.total / v.count : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
