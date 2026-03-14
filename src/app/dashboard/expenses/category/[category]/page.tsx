"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import RevenueChart from "@/components/charts/RevenueChart";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

interface CategoryData {
  category: string;
  total: number;
  count: number;
  average: number;
  totalPages: number;
  monthlyTrend: { month: string; total: number }[];
  vendorBreakdown: { vendorName: string; total: number; count: number }[];
  expenses: {
    id: string;
    date: string;
    amount: number;
    vendorName: string;
    notes: string | null;
    paymentMethod: string | null;
  }[];
}

export default function CategoryDetailPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = use(params);
  const decodedCategory = decodeURIComponent(category);

  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<CategoryData | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setPage(0);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", "0");
    params.set("limit", "50");
    fetch(
      `/api/dashboard/expenses/category/${encodeURIComponent(decodedCategory)}?${params}`
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [startDate, endDate, decodedCategory]);

  // Separate effect for pagination (doesn't reset page)
  useEffect(() => {
    if (page === 0) return; // Already fetched on date change
    setLoading(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", String(page));
    params.set("limit", "50");
    fetch(
      `/api/dashboard/expenses/category/${encodeURIComponent(decodedCategory)}?${params}`
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [page, startDate, endDate, decodedCategory]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Back link + Title */}
      <div>
        <Link
          href="/dashboard/expenses"
          className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-2"
        >
          ← Back to Expenses
        </Link>
        <h2 className="text-xl font-semibold text-gray-900">
          {decodedCategory}
        </h2>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Spent"
          value={formatCurrency(data.total)}
          variant="danger"
        />
        <StatCard
          title="Transactions"
          value={data.count.toLocaleString()}
          variant="default"
        />
        <StatCard
          title="Average per Transaction"
          value={formatCurrency(data.average)}
          variant="warning"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        {data.monthlyTrend.length > 0 && (
          <RevenueChart
            data={data.monthlyTrend.map((m) => ({
              date: `${m.month}-01`,
              total: m.total,
            }))}
            title={`Monthly ${decodedCategory} Spending`}
          />
        )}

        {/* Top Vendors in this Category */}
        {data.vendorBreakdown.length > 0 && (
          <BarChartCard
            title={`Top Vendors — ${decodedCategory}`}
            data={data.vendorBreakdown.map((v) => ({
              name: v.vendorName,
              value: v.total,
            }))}
            color="#ef4444"
          />
        )}
      </div>

      {/* Expense Items Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-500">
            All {decodedCategory} Expenses
            <span className="ml-2 text-gray-400">
              ({data.count} total)
            </span>
          </h3>
        </div>

        {data.expenses.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400 text-sm">
            No expenses found for this period.
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((expense) => (
                  <tr
                    key={expense.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {formatDate(expense.date)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium">
                      {expense.vendorName}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">
                      {expense.notes || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {expense.paymentMethod ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                          {expense.paymentMethod}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-red-600">
                      {formatCurrency(expense.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Page {page + 1} of {data.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() =>
                      setPage((p) => Math.min(data.totalPages - 1, p + 1))
                    }
                    disabled={page >= data.totalPages - 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
