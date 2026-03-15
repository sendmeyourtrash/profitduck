"use client";

import { useEffect, useState, use } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import PlatformNav from "@/components/layout/PlatformNav";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square (In-Store)",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
};

interface PlatformDetailData {
  platform: string;
  orderCount: number;
  grossRevenue: number;
  totalFees: number;
  netPayout: number;
  commissionRate: number;
  avgOrderValue: number;
  tips: number;
  feeBreakdown: {
    commission: number;
    service: number;
    delivery: number;
    marketing: number;
    customer: number;
  };
  dailyRevenue: { date: string; total: number; orders: number }[];
  orders: {
    id: string;
    orderId: string;
    datetime: string;
    subtotal: number;
    tax: number;
    tip: number;
    fees: number;
    netPayout: number;
    cardBrand?: string;
    diningOption?: string;
    channel?: string;
    fulfillmentType?: string;
  }[];
  totalOrders: number;
  totalPages: number;
  paymentTypeBreakdown?: {
    type: string;
    total: number;
    subtotal: number;
    tax: number;
    tip: number;
    count: number;
  }[];
  orderTypeBreakdown?: {
    type: string;
    count: number;
    revenue: number;
    netPayout: number;
    fees: number;
  }[];
  diningOptionBreakdown?: { option: string; count: number; revenue: number }[];
  topItems?: { name: string; category: string; qty: number; revenue: number }[];
  categoryBreakdown?: { category: string; qty: number; revenue: number; itemCount: number }[];
}

export default function PlatformDetailPage({
  params,
}: {
  params: Promise<{ platform: string }>;
}) {
  const { platform } = use(params);
  const label = PLATFORM_LABELS[platform] || platform;

  const { startDate, endDate } = useDateRange();
  const [data, setData] = useState<PlatformDetailData | null>(null);
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
    fetch(`/api/dashboard/platforms/${platform}?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [platform, startDate, endDate]);

  const changePage = (newPage: number) => {
    setPage(newPage);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", String(newPage));
    params.set("limit", "50");
    fetch(`/api/dashboard/platforms/${platform}?${params}`)
      .then((r) => r.json())
      .then(setData);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data || data.orderCount === 0) {
    return (
      <div className="space-y-6">
        <PlatformNav />
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No data for {label}</p>
          <p className="mt-2">Try selecting a different date range.</p>
        </div>
      </div>
    );
  }

  const hasFees = Object.values(data.feeBreakdown).some((v) => v > 0);
  const isSquare = platform === "square";

  return (
    <div className="space-y-6">
      {/* Platform Navigation */}
      <PlatformNav />

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Net Payout"
          value={formatCurrency(data.netPayout)}
          variant="success"
        />
        <StatCard
          title="Total Orders"
          value={data.orderCount.toLocaleString()}
        />
        <StatCard
          title="Commission Rate"
          value={`${data.commissionRate}%`}
          variant={data.commissionRate <= 15 ? "success" : data.commissionRate <= 25 ? "warning" : "danger"}
        />
        <StatCard
          title="Avg Order"
          value={formatCurrency(data.avgOrderValue)}
        />
      </div>

      {/* Daily Revenue Chart */}
      {data.dailyRevenue.length > 0 && (
        <RevenueChart
          data={data.dailyRevenue.map((d) => ({
            date: d.date,
            total: d.total,
          }))}
          title={`${label} — Daily Revenue`}
        />
      )}

      {/* Fee Breakdown */}
      {hasFees && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Fee Breakdown
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(data.feeBreakdown)
              .filter(([, v]) => v > 0)
              .map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs text-gray-500 capitalize">{key}</p>
                  <p className="text-lg font-semibold text-gray-800">
                    {formatCurrency(value)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Square: Cash vs Credit Breakdown */}
      {data.paymentTypeBreakdown && data.paymentTypeBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Cash vs Credit Breakdown
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Payment Type</th>
                <th className="pb-2 font-medium text-right">Orders</th>
                <th className="pb-2 font-medium text-right">Subtotal</th>
                <th className="pb-2 font-medium text-right">Tax</th>
                <th className="pb-2 font-medium text-right">Tips</th>
                <th className="pb-2 font-medium text-right">Net Total</th>
                <th className="pb-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const total = data.paymentTypeBreakdown!.reduce((s, p) => s + p.total, 0);
                return (
                  <>
                    {data.paymentTypeBreakdown!.map((p) => (
                      <tr key={p.type} className="border-b border-gray-50">
                        <td className="py-2 text-gray-800 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${p.type === "Cash" ? "bg-green-500" : "bg-indigo-500"}`} />
                            {p.type}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-600">{p.count}</td>
                        <td className="py-2 text-right text-gray-600">{formatCurrency(p.subtotal)}</td>
                        <td className="py-2 text-right text-gray-600">{formatCurrency(p.tax)}</td>
                        <td className="py-2 text-right text-gray-600">{formatCurrency(p.tip)}</td>
                        <td className="py-2 text-right font-medium text-gray-800">{formatCurrency(p.total)}</td>
                        <td className="py-2 text-right text-gray-600">
                          {total > 0 ? ((p.total / total) * 100).toFixed(1) : "0"}%
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 font-medium">
                      <td className="py-2 text-gray-800">Total</td>
                      <td className="py-2 text-right text-gray-600">
                        {data.paymentTypeBreakdown!.reduce((s, p) => s + p.count, 0)}
                      </td>
                      <td className="py-2 text-right text-gray-600">
                        {formatCurrency(data.paymentTypeBreakdown!.reduce((s, p) => s + p.subtotal, 0))}
                      </td>
                      <td className="py-2 text-right text-gray-600">
                        {formatCurrency(data.paymentTypeBreakdown!.reduce((s, p) => s + p.tax, 0))}
                      </td>
                      <td className="py-2 text-right text-gray-600">
                        {formatCurrency(data.paymentTypeBreakdown!.reduce((s, p) => s + p.tip, 0))}
                      </td>
                      <td className="py-2 text-right font-medium text-gray-800">
                        {formatCurrency(total)}
                      </td>
                      <td className="py-2 text-right text-gray-600">100%</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Delivery platforms: Order Type Breakdown */}
      {data.orderTypeBreakdown && data.orderTypeBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Order Type Breakdown
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium text-right">Orders</th>
                <th className="pb-2 font-medium text-right">Revenue</th>
                <th className="pb-2 font-medium text-right">Fees</th>
                <th className="pb-2 font-medium text-right">Net Payout</th>
                <th className="pb-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalRev = data.orderTypeBreakdown!.reduce((s, o) => s + o.revenue, 0);
                return data.orderTypeBreakdown!.map((o) => (
                  <tr key={o.type} className="border-b border-gray-50">
                    <td className="py-2 text-gray-800 font-medium capitalize">{o.type || "Unknown"}</td>
                    <td className="py-2 text-right text-gray-600">{o.count}</td>
                    <td className="py-2 text-right text-gray-600">{formatCurrency(o.revenue)}</td>
                    <td className="py-2 text-right text-red-600">{formatCurrency(o.fees)}</td>
                    <td className="py-2 text-right font-medium text-emerald-600">{formatCurrency(o.netPayout)}</td>
                    <td className="py-2 text-right text-gray-600">
                      {totalRev > 0 ? ((o.revenue / totalRev) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Square: Dining Options */}
      {data.diningOptionBreakdown && data.diningOptionBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Dining Options
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.diningOptionBreakdown.map((d) => (
              <div key={d.option} className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">{d.option}</p>
                <p className="text-xl font-bold text-gray-800">{d.count}</p>
                <p className="text-sm text-gray-500">{formatCurrency(d.revenue)} revenue</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item Category Breakdown (Square) */}
      {data.categoryBreakdown && data.categoryBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Revenue by Menu Category
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium text-right">Items Sold</th>
                <th className="pb-2 font-medium text-right">Revenue</th>
                <th className="pb-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalRev = data.categoryBreakdown!.reduce((s, c) => s + c.revenue, 0);
                return data.categoryBreakdown!.map((c) => (
                  <tr key={c.category} className="border-b border-gray-50">
                    <td className="py-2 text-gray-800 font-medium">{c.category}</td>
                    <td className="py-2 text-right text-gray-600">{c.qty}</td>
                    <td className="py-2 text-right font-medium text-gray-800">{formatCurrency(c.revenue)}</td>
                    <td className="py-2 text-right text-gray-600">
                      {totalRev > 0 ? ((c.revenue / totalRev) * 100).toFixed(1) : "0"}%
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Top Selling Items (Square) */}
      {data.topItems && data.topItems.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-4">
            Top Selling Items
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium text-right">Qty Sold</th>
                <th className="pb-2 font-medium text-right">Revenue</th>
                <th className="pb-2 font-medium text-right">Avg Price</th>
              </tr>
            </thead>
            <tbody>
              {data.topItems.map((item) => (
                <tr key={item.name} className="border-b border-gray-50">
                  <td className="py-2 text-gray-800 font-medium">{item.name}</td>
                  <td className="py-2 text-gray-500">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                      {item.category}
                    </span>
                  </td>
                  <td className="py-2 text-right text-gray-600">{item.qty}</td>
                  <td className="py-2 text-right font-medium text-gray-800">{formatCurrency(item.revenue)}</td>
                  <td className="py-2 text-right text-gray-600">
                    {formatCurrency(item.qty > 0 ? item.revenue / item.qty : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Order Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-500">
            Orders ({data.totalOrders.toLocaleString()} total)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Order ID</th>
                {isSquare && <th className="px-4 py-3 font-medium">Payment</th>}
                {isSquare && <th className="px-4 py-3 font-medium">Dining</th>}
                {!isSquare && <th className="px-4 py-3 font-medium">Channel</th>}
                <th className="px-4 py-3 font-medium text-right">Subtotal</th>
                <th className="px-4 py-3 font-medium text-right">Tax</th>
                <th className="px-4 py-3 font-medium text-right">Tip</th>
                <th className="px-4 py-3 font-medium text-right">Fees</th>
                <th className="px-4 py-3 font-medium text-right">Net Payout</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-600">{formatDateTime(o.datetime)}</td>
                  <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">
                    {o.orderId.length > 12 ? o.orderId.slice(0, 12) + "..." : o.orderId}
                  </td>
                  {isSquare && (
                    <td className="px-4 py-2.5 text-gray-600">{o.cardBrand || "Cash"}</td>
                  )}
                  {isSquare && (
                    <td className="px-4 py-2.5 text-gray-600">{o.diningOption || "-"}</td>
                  )}
                  {!isSquare && (
                    <td className="px-4 py-2.5 text-gray-600 capitalize">
                      {o.channel || o.fulfillmentType || "-"}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatCurrency(o.subtotal)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatCurrency(o.tax)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatCurrency(o.tip)}</td>
                  <td className="px-4 py-2.5 text-right text-red-600">{formatCurrency(o.fees)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-600">
                    {formatCurrency(o.netPayout)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data.totalPages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => changePage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page + 1} of {data.totalPages}
            </span>
            <button
              onClick={() => changePage(Math.min(data.totalPages - 1, page + 1))}
              disabled={page >= data.totalPages - 1}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
