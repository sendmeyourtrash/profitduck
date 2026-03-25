"use client";

import { useState, useEffect } from "react";
import StatCard from "@/components/charts/StatCard";
import { formatCurrency } from "@/lib/utils/format";

interface TaxData {
  year: number;
  availableYears: number[];
  salesTax: {
    annual: { collected: number; orders: number; grossSales: number; effectiveRate: number };
    quarterly: { quarter: string; collected: number; grossSales: number; effectiveRate: number; orders: number; startDate: string; endDate: string; dueDate: string }[];
    monthly: { month: string; collected: number; grossSales: number }[];
    byPlatform: { platform: string; collected: number; grossSales: number; effectiveRate: number }[];
  };
  scheduleC: {
    totalDeductions: number;
    grossRevenue: number;
    lines: { line: string; label: string; categories: string[]; amount: number }[];
  };
  estimatedTax: {
    annualProfit: number;
    selfEmploymentTax: number;
    estimatedIncomeTax: number;
    totalEstimated: number;
    quarterlyPayment: number;
    payments: { quarter: string; dueDate: string; amount: number; status: string }[];
  };
  taxPaymentsMade: { date: string; description: string; amount: number }[];
  totalPaid: number;
  balanceDue: number;
  deadlines: { type: string; period: string; dueDate: string; amount: number; status: string }[];
}

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square", doordash: "DoorDash", grubhub: "GrubHub", ubereats: "Uber Eats",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TaxPage() {
  const [data, setData] = useState<TaxData | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/tax?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [year]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  const upcomingDeadlines = data.deadlines.filter((d) => d.status !== "past");
  const currentDeadlines = data.deadlines.filter((d) => d.status === "current");

  return (
    <div className={`space-y-6 transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tax Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sales tax, estimated payments, and Schedule C summary</p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
        >
          {data.availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Sales Tax Collected"
          value={formatCurrency(data.salesTax.annual.collected)}
          subtitle={`${data.salesTax.annual.effectiveRate}% effective rate`}
          variant="default"
        />
        <StatCard
          title="Estimated Tax Liability"
          value={formatCurrency(data.estimatedTax.totalEstimated)}
          subtitle={`SE: ${formatCurrency(data.estimatedTax.selfEmploymentTax)} + Income: ${formatCurrency(data.estimatedTax.estimatedIncomeTax)}`}
          variant="warning"
        />
        <StatCard
          title="Tax Payments Made"
          value={formatCurrency(data.totalPaid)}
          subtitle={`${data.taxPaymentsMade.length} payment${data.taxPaymentsMade.length !== 1 ? "s" : ""}`}
          variant="default"
        />
        <StatCard
          title="Balance"
          value={formatCurrency(Math.abs(data.balanceDue))}
          subtitle={data.balanceDue <= 0 ? "Overpaid / Credit" : "Still owed"}
          variant={data.balanceDue <= 0 ? "success" : "danger"}
        />
      </div>

      {/* Upcoming Deadlines */}
      {(currentDeadlines.length > 0 || upcomingDeadlines.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="text-sm font-medium text-amber-800 mb-3">Upcoming Deadlines</h3>
          <div className="space-y-2">
            {(currentDeadlines.length > 0 ? currentDeadlines : upcomingDeadlines.slice(0, 4)).map((dl, i) => (
              <div key={i} className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-amber-100">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${dl.status === "current" ? "bg-amber-500" : "bg-gray-300"}`} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{dl.type}</p>
                    <p className="text-xs text-gray-500">{dl.period}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">{formatCurrency(dl.amount)}</p>
                  <p className="text-xs text-gray-500">Due {formatDate(dl.dueDate)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales Tax + Schedule C side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Tax by Quarter */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Sales Tax by Quarter</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Quarter</th>
                <th className="pb-2 font-medium text-right">Gross Sales</th>
                <th className="pb-2 font-medium text-right">Tax</th>
                <th className="pb-2 font-medium text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.salesTax.quarterly.map((q) => (
                <tr key={q.quarter} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 font-medium text-gray-800">{q.quarter}</td>
                  <td className="py-2.5 text-right text-gray-600">{formatCurrency(q.grossSales)}</td>
                  <td className="py-2.5 text-right font-medium text-indigo-600">{formatCurrency(q.collected)}</td>
                  <td className="py-2.5 text-right text-gray-500">{q.effectiveRate}%</td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium">
                <td className="py-2.5 text-gray-800">Total</td>
                <td className="py-2.5 text-right text-gray-800">{formatCurrency(data.salesTax.annual.grossSales)}</td>
                <td className="py-2.5 text-right text-indigo-600">{formatCurrency(data.salesTax.annual.collected)}</td>
                <td className="py-2.5 text-right text-gray-500">{data.salesTax.annual.effectiveRate}%</td>
              </tr>
            </tbody>
          </table>

          {/* Platform breakdown */}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-2">By Platform</p>
            <div className="space-y-1.5">
              {data.salesTax.byPlatform.map((p) => (
                <div key={p.platform} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{PLATFORM_LABELS[p.platform] || p.platform}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">{formatCurrency(p.grossSales)} sales</span>
                    <span className="font-medium text-gray-800">{formatCurrency(p.collected)} tax</span>
                    <span className="text-gray-400">{p.effectiveRate}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Schedule C */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Schedule C Summary</h3>
            <span className="text-xs text-gray-400">Gross Revenue: {formatCurrency(data.scheduleC.grossRevenue)}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Line</th>
                <th className="pb-2 font-medium">Description</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.scheduleC.lines.map((l, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 text-gray-500 text-xs w-12">{l.line}</td>
                  <td className="py-2.5">
                    <p className="font-medium text-gray-800">{l.label}</p>
                    <p className="text-[10px] text-gray-400">{l.categories.join(", ")}</p>
                  </td>
                  <td className="py-2.5 text-right font-medium text-gray-800">{formatCurrency(l.amount)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-200 font-medium">
                <td className="py-2.5" />
                <td className="py-2.5 text-gray-800">Total Deductions</td>
                <td className="py-2.5 text-right text-emerald-600 text-base">{formatCurrency(data.scheduleC.totalDeductions)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-2.5" />
                <td className="py-2.5 text-gray-800">Net Profit (Line 31)</td>
                <td className={`py-2.5 text-right text-base ${data.estimatedTax.annualProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {formatCurrency(data.estimatedTax.annualProfit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Estimated Tax + Payments side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Estimated Quarterly Payments */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Estimated Quarterly Payments</h3>
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Self-Employment</p>
                <p className="text-sm font-bold text-gray-800">{formatCurrency(data.estimatedTax.selfEmploymentTax)}</p>
                <p className="text-[10px] text-gray-400">15.3% of 92.35%</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Income Tax</p>
                <p className="text-sm font-bold text-gray-800">{formatCurrency(data.estimatedTax.estimatedIncomeTax)}</p>
                <p className="text-[10px] text-gray-400">~22% bracket</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total Annual</p>
                <p className="text-sm font-bold text-indigo-600">{formatCurrency(data.estimatedTax.totalEstimated)}</p>
                <p className="text-[10px] text-gray-400">= {formatCurrency(data.estimatedTax.quarterlyPayment)}/qtr</p>
              </div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Quarter</th>
                <th className="pb-2 font-medium text-right">Amount</th>
                <th className="pb-2 font-medium text-right">Due Date</th>
                <th className="pb-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.estimatedTax.payments.map((p) => (
                <tr key={p.quarter} className="border-b border-gray-50">
                  <td className="py-2.5 font-medium text-gray-800">{p.quarter}</td>
                  <td className="py-2.5 text-right text-gray-600">{formatCurrency(p.amount)}</td>
                  <td className="py-2.5 text-right text-gray-500">{formatDate(p.dueDate)}</td>
                  <td className="py-2.5 text-right">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      p.status === "past" ? "bg-gray-100 text-gray-500"
                        : p.status === "current" ? "bg-amber-100 text-amber-700"
                        : "bg-blue-50 text-blue-600"
                    }`}>
                      {p.status === "past" ? "Past" : p.status === "current" ? "Due Soon" : "Upcoming"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Tax Payments Made */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500">Tax Payments Made</h3>
            <span className="text-sm font-bold text-gray-800">Total: {formatCurrency(data.totalPaid)}</span>
          </div>
          {data.taxPaymentsMade.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No tax payments recorded for {year}.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.taxPaymentsMade.map((t, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 text-gray-600 whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="py-2.5 text-gray-800 font-medium">{t.description}</td>
                    <td className="py-2.5 text-right font-medium text-red-600">{formatCurrency(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Balance summary */}
          <div className={`mt-4 p-3 rounded-lg ${data.balanceDue <= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-medium ${data.balanceDue <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {data.balanceDue <= 0 ? "Overpaid / Credit" : "Remaining Balance"}
              </span>
              <span className={`text-lg font-bold ${data.balanceDue <= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {formatCurrency(Math.abs(data.balanceDue))}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Sales Tax Detail */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">Monthly Sales Tax Detail</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.salesTax.monthly.map((m) => {
            const monthIdx = parseInt(m.month.split("-")[1]) - 1;
            return (
              <div key={m.month} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{MONTH_NAMES[monthIdx]} {year}</p>
                <p className="text-sm font-bold text-gray-900">{formatCurrency(m.collected)}</p>
                <p className="text-[10px] text-gray-400">{formatCurrency(m.grossSales)} sales</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-400">
          This is an estimate for planning purposes only. Tax calculations use simplified rates (22% income bracket, 15.3% SE tax).
          Actual liability may differ based on filing status, other income, deductions, and credits.
          Consult a tax professional for accurate filing. Schedule C mappings are approximate and should be verified.
        </p>
      </div>
    </div>
  );
}
