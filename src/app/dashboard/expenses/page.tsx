"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import RevenueChart from "@/components/charts/RevenueChart";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

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
  feesByPlatform: {
    platform: string;
    fees: number;
    breakdown: {
      commission: number;
      service: number;
      delivery: number;
      marketing: number;
      customer: number;
    };
  }[];
}

export default function ExpensesPage() {
  const router = useRouter();
  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<ExpenseData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    fetch(`/api/dashboard/expenses?${params}`)
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

  const totalExpenses = data.expensesByVendor.reduce(
    (sum, v) => sum + v.total,
    0
  );
  const totalFees = data.feesByPlatform.reduce((sum, f) => sum + f.fees, 0);

  return (
    <div className="space-y-6">
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
          onBarClick={(name) =>
            router.push(
              `/dashboard/expenses/vendor/${encodeURIComponent(name)}`
            )
          }
        />
        <BarChartCard
          title="Expenses by Category"
          data={data.expensesByCategory.map((c) => ({
            name: c.category,
            value: c.total,
          }))}
          color="#f59e0b"
          onBarClick={(name) =>
            router.push(
              `/dashboard/expenses/category/${encodeURIComponent(name)}`
            )
          }
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
                <th className="pb-2 font-medium text-right">Commission</th>
                <th className="pb-2 font-medium text-right">Service</th>
                <th className="pb-2 font-medium text-right">Marketing</th>
                <th className="pb-2 font-medium text-right">Total Fees</th>
              </tr>
            </thead>
            <tbody>
              {data.feesByPlatform.map((f) => (
                <tr key={f.platform} className="border-b border-gray-50">
                  <td className="py-2 text-gray-800 capitalize">{f.platform}</td>
                  <td className="py-2 text-right text-gray-600">
                    {f.breakdown?.commission > 0 ? formatCurrency(f.breakdown?.commission) : "—"}
                  </td>
                  <td className="py-2 text-right text-gray-600">
                    {f.breakdown?.service > 0 ? formatCurrency(f.breakdown?.service) : "—"}
                  </td>
                  <td className="py-2 text-right text-gray-600">
                    {f.breakdown?.marketing > 0 ? formatCurrency(f.breakdown?.marketing) : "—"}
                  </td>
                  <td className="py-2 text-right font-medium text-amber-600">
                    {formatCurrency(f.fees)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium">
                <td className="py-2 text-gray-800">Total</td>
                <td className="py-2 text-right text-gray-600">
                  {formatCurrency(data.feesByPlatform.reduce((s, f) => s + f.breakdown?.commission, 0))}
                </td>
                <td className="py-2 text-right text-gray-600">
                  {formatCurrency(data.feesByPlatform.reduce((s, f) => s + f.breakdown?.service, 0))}
                </td>
                <td className="py-2 text-right text-gray-600">
                  {formatCurrency(data.feesByPlatform.reduce((s, f) => s + f.breakdown?.marketing, 0))}
                </td>
                <td className="py-2 text-right font-medium text-amber-600">
                  {formatCurrency(totalFees)}
                </td>
              </tr>
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
                <tr
                  key={v.vendorId}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() =>
                    router.push(
                      `/dashboard/expenses/vendor/${encodeURIComponent(v.vendorName)}`
                    )
                  }
                >
                  <td className="py-2 text-indigo-600 hover:text-indigo-800 font-medium">
                    {v.vendorName}
                    <span className="ml-1.5 text-gray-400 text-xs">→</span>
                  </td>
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
