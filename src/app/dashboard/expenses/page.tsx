"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import RevenueChart from "@/components/charts/RevenueChart";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

interface ExpenseData {
  summary: {
    totalExpenses: number;
    prevTotalExpenses: number;
    expenseChange: number;
    totalFees: number;
    prevTotalFees: number;
    feesChange: number;
    combinedCosts: number;
    prevCombinedCosts: number;
    combinedChange: number;
  };
  movers: {
    category: string;
    current: number;
    previous: number;
    change: number;
    direction: "up" | "down";
  }[];
  expensesByVendor: {
    vendorId: string;
    vendorName: string;
    total: number;
    prevTotal: number;
    change: number;
    count: number;
  }[];
  expensesByCategory: {
    category: string;
    total: number;
    prevTotal: number;
    change: number;
    count: number;
  }[];
  dailyExpenses: { date: string; total: number }[];
  expensesByPaymentMethod: {
    paymentMethod: string;
    total: number;
    count: number;
  }[];
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
  costSplit: {
    recurring: {
      total: number;
      count: number;
      pct: number;
      categories: { category: string; total: number; count: number }[];
    };
    variable: {
      total: number;
      count: number;
      pct: number;
      categories: { category: string; total: number; count: number }[];
    };
  };
  topTransactions: {
    id: number;
    date: string;
    vendorName: string;
    category: string;
    amount: number;
    note: string | null;
  }[];
  monthlyBudget: {
    currentMonth: string;
    spent: number;
    monthlyAvg: number;
    projected: number;
    dayOfMonth: number;
    daysInMonth: number;
    paceVsAvg: number;
  };
}

export default function ExpensesPage() {
  const router = useRouter();
  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<ExpenseData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (data) setRefreshing(true);
    else setInitialLoading(true);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    fetch(`/api/dashboard/expenses?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  const { summary, movers } = data;

  return (
    <div className={`space-y-6 transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Biggest Movers Callout */}
      {movers.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <h3 className="text-sm font-medium text-amber-800 mb-2">Biggest Movers vs Prior Period</h3>
          <div className="flex flex-wrap gap-3">
            {movers.map((m) => (
              <div
                key={m.category}
                className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-amber-200 cursor-pointer hover:border-amber-400 transition-colors"
                onClick={() => router.push(`/dashboard/expenses/category/${encodeURIComponent(m.category)}`)}
              >
                <span className={`text-xs font-bold ${m.direction === "up" ? "text-red-600" : "text-emerald-600"}`}>
                  {m.direction === "up" ? "↑" : "↓"} {Math.abs(m.change)}%
                </span>
                <span className="text-xs text-gray-700 font-medium">{m.category}</span>
                <span className="text-[10px] text-gray-400">
                  {formatCurrency(m.previous)} → {formatCurrency(m.current)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary with prior period comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(summary.totalExpenses)}
          subtitle={`Prev: ${formatCurrency(summary.prevTotalExpenses)}`}
          variant="danger"
          trend={{ value: -summary.expenseChange, label: "vs prior period" }}
        />
        <StatCard
          title="Platform Fees"
          value={formatCurrency(summary.totalFees)}
          subtitle={`Prev: ${formatCurrency(summary.prevTotalFees)}`}
          variant="warning"
          trend={{ value: -summary.feesChange, label: "vs prior period" }}
        />
        <StatCard
          title="Combined Costs"
          value={formatCurrency(summary.combinedCosts)}
          subtitle={`Prev: ${formatCurrency(summary.prevCombinedCosts)}`}
          variant="danger"
          trend={{ value: -summary.combinedChange, label: "vs prior period" }}
        />
      </div>

      {/* Monthly Budget + Cost Split + Top Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly Budget Pace */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Monthly Pace</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Spent this month</span>
                <span>{formatCurrency(data.monthlyBudget.spent)} / ~{formatCurrency(data.monthlyBudget.monthlyAvg)} avg</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all ${
                    (data.monthlyBudget.spent / data.monthlyBudget.monthlyAvg) > 0.9
                      ? "bg-red-500"
                      : (data.monthlyBudget.spent / data.monthlyBudget.monthlyAvg) > 0.7
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, data.monthlyBudget.monthlyAvg > 0 ? (data.monthlyBudget.spent / data.monthlyBudget.monthlyAvg) * 100 : 0)}%` }}
                />
              </div>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-gray-400">Day {data.monthlyBudget.dayOfMonth} of {data.monthlyBudget.daysInMonth}</span>
              <div className="text-right">
                <p className="text-xs text-gray-400">Projected month-end</p>
                <p className={`text-sm font-bold ${data.monthlyBudget.paceVsAvg > 10 ? "text-red-600" : data.monthlyBudget.paceVsAvg < -10 ? "text-emerald-600" : "text-gray-800"}`}>
                  {formatCurrency(data.monthlyBudget.projected)}
                  <span className="text-[10px] font-normal text-gray-400 ml-1">
                    ({data.monthlyBudget.paceVsAvg > 0 ? "+" : ""}{data.monthlyBudget.paceVsAvg}% vs avg)
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Recurring vs Variable */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Fixed vs Variable</h3>
          {/* Stacked bar */}
          <div className="w-full h-4 rounded-full overflow-hidden flex mb-3">
            <div
              className="bg-indigo-500 h-4"
              style={{ width: `${data.costSplit.recurring.pct}%` }}
              title={`Fixed: ${data.costSplit.recurring.pct}%`}
            />
            <div
              className="bg-amber-400 h-4"
              style={{ width: `${data.costSplit.variable.pct}%` }}
              title={`Variable: ${data.costSplit.variable.pct}%`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                <span className="text-xs text-gray-500">Fixed</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(data.costSplit.recurring.total)}</p>
              <p className="text-[10px] text-gray-400">{data.costSplit.recurring.pct}% of total</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                <span className="text-xs text-gray-500">Variable</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(data.costSplit.variable.total)}</p>
              <p className="text-[10px] text-gray-400">{data.costSplit.variable.pct}% of total</p>
            </div>
          </div>
        </div>

        {/* Top Single Transactions */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Largest Transactions</h3>
          <div className="space-y-2">
            {data.topTransactions.map((tx, i) => (
              <div key={tx.id} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-4 shrink-0">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{tx.vendorName}</p>
                  <p className="text-[10px] text-gray-400">{tx.date} · {tx.category}</p>
                </div>
                <span className="text-sm font-bold text-red-600 shrink-0">{formatCurrency(tx.amount)}</span>
              </div>
            ))}
          </div>
        </div>
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

      {/* Payment Method Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">
          Expenses by Payment Method
        </h3>
        {data.expensesByPaymentMethod.length === 0 ? (
          <p className="text-gray-400 text-sm">No payment method data available</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Payment Method</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium text-right">Transactions</th>
                <th className="pb-2 font-medium text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {data.expensesByPaymentMethod.map((pm) => (
                <tr key={pm.paymentMethod} className="border-b border-gray-50">
                  <td className="py-2 text-gray-800 font-medium">{pm.paymentMethod}</td>
                  <td className="py-2 text-right font-medium text-red-600">
                    {formatCurrency(pm.total)}
                  </td>
                  <td className="py-2 text-right text-gray-600">{pm.count}</td>
                  <td className="py-2 text-right text-gray-600">
                    {summary.totalExpenses > 0
                      ? ((pm.total / summary.totalExpenses) * 100).toFixed(1)
                      : "0"}
                    %
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium">
                <td className="py-2 text-gray-800">Total</td>
                <td className="py-2 text-right font-medium text-red-600">
                  {formatCurrency(summary.totalExpenses)}
                </td>
                <td className="py-2 text-right text-gray-600">
                  {data.expensesByPaymentMethod.reduce((s, pm) => s + pm.count, 0)}
                </td>
                <td className="py-2 text-right text-gray-600">100%</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Expense Trend — monthly aggregation */}
      <RevenueChart
        data={data.dailyExpenses}
        title="Expense Trend"
        defaultPeriod="monthly"
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
                  {formatCurrency(summary.totalFees)}
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
                <th className="pb-2 font-medium text-right">Txns</th>
                <th className="pb-2 font-medium text-right">Avg</th>
                <th className="pb-2 font-medium text-right">Change</th>
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
                  <td className="py-2 text-right">
                    {v.prevTotal > 0 ? (
                      <span className={`text-xs font-medium ${v.change <= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {v.change > 0 ? "↑" : "↓"} {Math.abs(v.change)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">new</span>
                    )}
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
