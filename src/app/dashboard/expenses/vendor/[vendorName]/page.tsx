"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import RevenueChart from "@/components/charts/RevenueChart";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

interface VendorData {
  vendorName: string;
  total: number;
  count: number;
  average: number;
  prevTotal: number;
  prevCount: number;
  change: number;
  stats: { min: number; max: number; median: number; average: number };
  frequency: { label: string; avgDaysBetween: number } | null;
  totalPages: number;
  monthlyTrend: { month: string; total: number }[];
  categoryBreakdown: { category: string; total: number; count: number }[];
  expenses: {
    id: string;
    date: string;
    amount: number;
    category: string;
    notes: string | null;
    paymentMethod: string | null;
  }[];
}

export default function VendorDetailPage({
  params,
}: {
  params: Promise<{ vendorName: string }>;
}) {
  const { vendorName } = use(params);
  const decodedVendor = decodeURIComponent(vendorName);

  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<VendorData | null>(null);
  const [page, setPage] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (data) setRefreshing(true);
    else setInitialLoading(true);
    setPage(0);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", "0");
    params.set("limit", "50");
    fetch(
      `/api/dashboard/expenses/vendor/${encodeURIComponent(decodedVendor)}?${params}`
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, decodedVendor]);

  useEffect(() => {
    if (page === 0) return;
    setRefreshing(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", String(page));
    params.set("limit", "50");
    fetch(
      `/api/dashboard/expenses/vendor/${encodeURIComponent(decodedVendor)}?${params}`
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setRefreshing(false));
  }, [page, startDate, endDate, decodedVendor]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={`space-y-6 transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Back link + Title + Frequency */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/dashboard/expenses"
            className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-2"
          >
            &larr; Back to Expenses
          </Link>
          <h2 className="text-xl font-semibold text-gray-900">
            {decodedVendor}
          </h2>
        </div>
        {data.frequency && (
          <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full mt-6">
            {data.frequency.label}
          </span>
        )}
      </div>

      {/* Summary Stats with comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Spent"
          value={formatCurrency(data.total)}
          subtitle={`Prev: ${formatCurrency(data.prevTotal)}`}
          variant="danger"
          trend={data.prevTotal > 0 ? { value: -data.change, label: "vs prior period" } : undefined}
        />
        <StatCard
          title="Transactions"
          value={data.count.toLocaleString()}
          subtitle={`Prev: ${data.prevCount}`}
          variant="default"
        />
        <StatCard
          title="Average per Transaction"
          value={formatCurrency(data.average)}
          variant="warning"
        />
      </div>

      {/* Min / Max / Median row */}
      {data.count > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Min</p>
              <p className="text-sm font-bold text-emerald-600">{formatCurrency(data.stats.min)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Median</p>
              <p className="text-sm font-bold text-gray-800">{formatCurrency(data.stats.median)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Average</p>
              <p className="text-sm font-bold text-gray-800">{formatCurrency(data.stats.average)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Max</p>
              <p className="text-sm font-bold text-red-600">{formatCurrency(data.stats.max)}</p>
            </div>
          </div>
          {/* Spread indicator */}
          {data.stats.max > 0 && (
            <div className="mt-3 px-4">
              <div className="relative w-full h-2 bg-gray-100 rounded-full">
                <div
                  className="absolute h-2 bg-gradient-to-r from-emerald-400 via-gray-300 to-red-400 rounded-full"
                  style={{
                    left: `${(data.stats.min / data.stats.max) * 100}%`,
                    width: `${100 - (data.stats.min / data.stats.max) * 100}%`,
                  }}
                />
                {/* Median marker */}
                <div
                  className="absolute -top-0.5 w-1 h-3 bg-gray-800 rounded-full"
                  style={{ left: `${(data.stats.median / data.stats.max) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {data.monthlyTrend.length > 0 && (
          <RevenueChart
            data={data.monthlyTrend.map((m) => ({
              date: `${m.month}-01`,
              total: m.total,
            }))}
            title={`Monthly Spending — ${decodedVendor}`}
          />
        )}
        {data.categoryBreakdown.length > 0 && (
          <BarChartCard
            title={`Categories — ${decodedVendor}`}
            data={data.categoryBreakdown.map((c) => ({
              name: c.category,
              value: c.total,
            }))}
            color="#f59e0b"
          />
        )}
      </div>

      {/* Expense Items Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-500">
            All Charges — {decodedVendor}
            <span className="ml-2 text-gray-400">({data.count} total)</span>
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
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((expense) => (
                  <tr key={expense.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(expense.date)}</td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{expense.category}</td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">{expense.notes || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {expense.paymentMethod ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{expense.paymentMethod}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-red-600">{formatCurrency(expense.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm text-gray-500">Page {page + 1} of {data.totalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Previous</button>
                  <button onClick={() => setPage((p) => Math.min(data.totalPages - 1, p + 1))} disabled={page >= data.totalPages - 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
