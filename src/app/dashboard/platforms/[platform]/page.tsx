"use client";

import { useEffect, useState, useMemo, useCallback, use } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

type SortDirection = "asc" | "desc";
type SortConfig = { key: string; dir: SortDirection } | null;

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  return (
    <svg className={`inline-block w-3 h-3 ml-1 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-300 dark:text-gray-600"}`} viewBox="0 0 10 14" fill="currentColor">
      {(!active || dir === "asc") && <path d="M5 0L9.33 5H0.67L5 0Z" opacity={active && dir === "asc" ? 1 : 0.4} />}
      {(!active || dir === "desc") && <path d="M5 14L0.67 9H9.33L5 14Z" opacity={active && dir === "desc" ? 1 : 0.4} />}
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortData<T extends Record<string, any>>(items: T[], sort: SortConfig): T[] {
  if (!sort) return items;
  return [...items].sort((a, b) => {
    const aVal = a[sort.key] ?? "";
    const bVal = b[sort.key] ?? "";
    const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal) : (aVal as number) - (bVal as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

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
    processing: number;
    delivery: number;
    marketing: number;
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
  modifierAnalytics?: { name: string; group: string; count: number; revenue: number; avgPrice: number; pctOfOrders: number }[];
  totalItemsWithModifiers?: number;
  totalModifierRevenue?: number;
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
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [itemsVisible, setItemsVisible] = useState(10);

  // Sort states for each table
  const [paymentSort, setPaymentSort] = useState<SortConfig>(null);
  const [orderTypeSort, setOrderTypeSort] = useState<SortConfig>(null);
  const [categorySort, setCategorySort] = useState<SortConfig>(null);
  const [topItemsSort, setTopItemsSort] = useState<SortConfig>(null);
  const [ordersSort, setOrdersSort] = useState<SortConfig>(null);
  const [modifierSort, setModifierSort] = useState<SortConfig>(null);

  const toggleSort = useCallback((setter: React.Dispatch<React.SetStateAction<SortConfig>>, key: string) => {
    setter((prev) => {
      if (prev?.key === key) {
        return prev.dir === "asc" ? { key, dir: "desc" } : null;
      }
      return { key, dir: "asc" };
    });
  }, []);

  // Memoized sorted data
  const sortedTopItems = useMemo(
    () => sortData(
      (data?.topItems || []).map(i => ({ ...i, avgPrice: i.qty > 0 ? i.revenue / i.qty : 0 })),
      topItemsSort
    ),
    [data?.topItems, topItemsSort]
  );
  const sortedCategories = useMemo(() => {
    const items = data?.categoryBreakdown || [];
    const totalRev = items.reduce((s, c) => s + c.revenue, 0);
    return sortData(
      items.map(c => ({ ...c, pct: totalRev > 0 ? (c.revenue / totalRev) * 100 : 0 })),
      categorySort
    );
  }, [data?.categoryBreakdown, categorySort]);
  const sortedPayments = useMemo(
    () => sortData(data?.paymentTypeBreakdown || [], paymentSort),
    [data?.paymentTypeBreakdown, paymentSort]
  );
  const sortedOrderTypes = useMemo(() => {
    const items = data?.orderTypeBreakdown || [];
    const totalRev = items.reduce((s, o) => s + o.revenue, 0);
    return sortData(
      items.map(o => ({ ...o, pct: totalRev > 0 ? (o.revenue / totalRev) * 100 : 0 })),
      orderTypeSort
    );
  }, [data?.orderTypeBreakdown, orderTypeSort]);
  const sortedModifiers = useMemo(
    () => sortData(data?.modifierAnalytics || [], modifierSort),
    [data?.modifierAnalytics, modifierSort]
  );
  const sortedOrders = useMemo(
    () => sortData(data?.orders || [], ordersSort),
    [data?.orders, ordersSort]
  );

  useEffect(() => {
    if (data) setRefreshing(true);
    else setInitialLoading(true);
    setPage(0);
    setItemsVisible(10);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", "0");
    params.set("limit", "50");
    fetch(`/api/dashboard/platforms/${platform}?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
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

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data || data.orderCount === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No data for {label}</p>
        <p className="mt-2">Try selecting a different date range.</p>
      </div>
    );
  }

  const hasFees = Object.values(data.feeBreakdown).some((v) => v > 0);
  const isSquare = platform === "square";

  return (
    <div className={`space-y-6 transition-opacity duration-150 ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Fee Breakdown
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(data.feeBreakdown)
              .filter(([, v]) => v > 0)
              .map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{key}</p>
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                    {formatCurrency(value)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Square: Cash vs Credit Breakdown */}
      {data.paymentTypeBreakdown && data.paymentTypeBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Cash vs Credit Breakdown
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-200/50 dark:border-gray-700/50">
                {[
                  { key: "type", label: "Payment Type" },
                  { key: "count", label: "Orders", right: true },
                  { key: "subtotal", label: "Subtotal", right: true },
                  { key: "tax", label: "Tax", right: true },
                  { key: "tip", label: "Tips", right: true },
                  { key: "total", label: "Net Total", right: true },
                ].map((col) => (
                  <th
                    key={col.key}
                    className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-600 ${col.right ? "text-right" : ""}`}
                    onClick={() => toggleSort(setPaymentSort, col.key)}
                  >
                    {col.label}
                    <SortIcon active={paymentSort?.key === col.key} dir={paymentSort?.dir || "asc"} />
                  </th>
                ))}
                <th className="pb-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const total = data.paymentTypeBreakdown!.reduce((s, p) => s + p.total, 0);
                return (
                  <>
                    {sortedPayments.map((p) => (
                      <tr key={p.type} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 text-gray-800 dark:text-gray-200 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${p.type === "Cash" ? "bg-green-500" : "bg-indigo-500"}`} />
                            {p.type}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{p.count}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(p.subtotal)}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(p.tax)}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(p.tip)}</td>
                        <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(p.total)}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {total > 0 ? ((p.total / total) * 100).toFixed(1) : "0"}%
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                      <td className="py-2 text-gray-800 dark:text-gray-200">Total</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                        {data.paymentTypeBreakdown!.reduce((s, p) => s + p.count, 0)}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(data.paymentTypeBreakdown!.reduce((s, p) => s + p.subtotal, 0))}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(data.paymentTypeBreakdown!.reduce((s, p) => s + p.tax, 0))}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(data.paymentTypeBreakdown!.reduce((s, p) => s + p.tip, 0))}
                      </td>
                      <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">
                        {formatCurrency(total)}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">100%</td>
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Order Type Breakdown
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-200/50 dark:border-gray-700/50">
                {[
                  { key: "type", label: "Type" },
                  { key: "count", label: "Orders", right: true },
                  { key: "revenue", label: "Revenue", right: true },
                  { key: "fees", label: "Fees", right: true },
                  { key: "netPayout", label: "Net Payout", right: true },
                  { key: "pct", label: "%", right: true },
                ].map((col) => (
                  <th
                    key={col.key}
                    className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-600 ${col.right ? "text-right" : ""}`}
                    onClick={() => toggleSort(setOrderTypeSort, col.key)}
                  >
                    {col.label}
                    <SortIcon active={orderTypeSort?.key === col.key} dir={orderTypeSort?.dir || "asc"} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalRev = data.orderTypeBreakdown!.reduce((s, o) => s + o.revenue, 0);
                return (
                  <>
                    {sortedOrderTypes.map((o) => (
                      <tr key={o.type} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 text-gray-800 dark:text-gray-200 font-medium capitalize">{o.type || "-"}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{o.count}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(o.revenue)}</td>
                        <td className="py-2 text-right text-red-600">{formatCurrency(o.fees)}</td>
                        <td className="py-2 text-right font-medium text-emerald-600">{formatCurrency(o.netPayout)}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {o.pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                      <td className="py-2 text-gray-800 dark:text-gray-200">Total</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                        {data.orderTypeBreakdown!.reduce((s, o) => s + o.count, 0)}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(totalRev)}
                      </td>
                      <td className="py-2 text-right text-red-600">
                        {formatCurrency(data.orderTypeBreakdown!.reduce((s, o) => s + o.fees, 0))}
                      </td>
                      <td className="py-2 text-right font-medium text-emerald-600">
                        {formatCurrency(data.orderTypeBreakdown!.reduce((s, o) => s + o.netPayout, 0))}
                      </td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">100%</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Square: Dining Options */}
      {data.diningOptionBreakdown && data.diningOptionBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Dining Options
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.diningOptionBreakdown.map((d) => (
              <div key={d.option} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">{d.option}</p>
                <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{d.count}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{formatCurrency(d.revenue)} revenue</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item Category Breakdown (Square) */}
      {data.categoryBreakdown && data.categoryBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Revenue by Menu Category
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-200/50 dark:border-gray-700/50">
                {[
                  { key: "category", label: "Category" },
                  { key: "qty", label: "Items Sold", right: true },
                  { key: "revenue", label: "Revenue", right: true },
                  { key: "pct", label: "%", right: true },
                ].map((col) => (
                  <th
                    key={col.key}
                    className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-600 ${col.right ? "text-right" : ""}`}
                    onClick={() => toggleSort(setCategorySort, col.key)}
                  >
                    {col.label}
                    <SortIcon active={categorySort?.key === col.key} dir={categorySort?.dir || "asc"} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalRev = data.categoryBreakdown!.reduce((s, c) => s + c.revenue, 0);
                const totalQty = data.categoryBreakdown!.reduce((s, c) => s + c.qty, 0);
                return (
                  <>
                    {sortedCategories.map((c) => (
                      <tr key={c.category} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 text-gray-800 dark:text-gray-200 font-medium">{c.category}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">{c.qty}</td>
                        <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(c.revenue)}</td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {c.pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                      <td className="py-2 text-gray-800 dark:text-gray-200">Total</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">{totalQty}</td>
                      <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(totalRev)}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-gray-400">100%</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Top Selling Items (all platforms with item data) */}
      {data.topItems && data.topItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Top Selling Items ({data.topItems.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                  {[
                    { key: "name", label: "Item" },
                    { key: "category", label: "Category" },
                    { key: "qty", label: "Qty Sold", right: true },
                    { key: "revenue", label: "Revenue", right: true },
                    { key: "avgPrice", label: "Avg Price", right: true },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`pb-2 px-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap ${col.right ? "text-right" : ""}`}
                      onClick={() => toggleSort(setTopItemsSort, col.key)}
                    >
                      {col.label}
                      <SortIcon active={topItemsSort?.key === col.key} dir={topItemsSort?.dir || "asc"} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTopItems.slice(0, itemsVisible).map((item) => (
                  <tr key={item.name} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">{item.name}</td>
                    <td className="py-2 px-3">
                      {item.category && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {item.category}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">{item.qty}</td>
                    <td className="py-2 px-3 text-right font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{formatCurrency(item.revenue)}</td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatCurrency(item.avgPrice)}
                    </td>
                  </tr>
                ))}
                {(() => {
                  const totalQty = data.topItems!.reduce((s, i) => s + i.qty, 0);
                  const totalRev = data.topItems!.reduce((s, i) => s + i.revenue, 0);
                  return (
                    <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                      <td className="py-2 px-3 text-gray-800 dark:text-gray-200">Total</td>
                      <td className="py-2 px-3" />
                      <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{totalQty}</td>
                      <td className="py-2 px-3 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(totalRev)}</td>
                      <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                        {formatCurrency(totalQty > 0 ? totalRev / totalQty : 0)}
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          {sortedTopItems.length > itemsVisible && (
            <button
              onClick={() => setItemsVisible((v) => v + 10)}
              className="mt-3 w-full text-center text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium py-2 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              Show 10 more ({sortedTopItems.length - itemsVisible} remaining)
            </button>
          )}
        </div>
      )}

      {/* Modifier Analytics (all platforms with modifier data) */}
      {data.modifierAnalytics && data.modifierAnalytics.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Popular Modifiers ({data.modifierAnalytics.length})
            </h3>
            {data.totalModifierRevenue !== undefined && data.totalModifierRevenue > 0 && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                +{formatCurrency(data.totalModifierRevenue)} modifier revenue
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[550px]">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                  {[
                    { key: "name", label: "Modifier" },
                    { key: "group", label: "Group" },
                    { key: "count", label: "Times Added", right: true },
                    { key: "revenue", label: "Revenue", right: true },
                    { key: "avgPrice", label: "Avg Price", right: true },
                    { key: "pctOfOrders", label: "% Orders", right: true },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`pb-2 px-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap ${col.right ? "text-right" : ""}`}
                      onClick={() => toggleSort(setModifierSort, col.key)}
                    >
                      {col.label}
                      <SortIcon active={modifierSort?.key === col.key} dir={modifierSort?.dir || "asc"} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedModifiers.slice(0, itemsVisible).map((mod) => (
                  <tr key={`${mod.group}-${mod.name}`} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">{mod.name}</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{mod.group || "-"}</td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">{mod.count}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {mod.revenue > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{formatCurrency(mod.revenue)}</span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">$0.00</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {mod.avgPrice > 0 ? formatCurrency(mod.avgPrice) : "Free"}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        mod.pctOfOrders >= 20
                          ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      }`}>
                        {mod.pctOfOrders}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedModifiers.length > itemsVisible && (
            <button
              onClick={() => setItemsVisible((v) => v + 10)}
              className="mt-3 w-full text-center text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium py-2 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              Show 10 more ({sortedModifiers.length - itemsVisible} remaining)
            </button>
          )}
        </div>
      )}

      {/* Order Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Orders ({data.totalOrders.toLocaleString()} total)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-gray-500 dark:text-gray-400">
                {[
                  { key: "datetime", label: "Date" },
                  { key: "orderId", label: "Order ID" },
                ].map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                    onClick={() => toggleSort(setOrdersSort, col.key)}
                  >
                    {col.label}
                    <SortIcon active={ordersSort?.key === col.key} dir={ordersSort?.dir || "asc"} />
                  </th>
                ))}
                {isSquare && (
                  <th
                    className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                    onClick={() => toggleSort(setOrdersSort, "cardBrand")}
                  >
                    Payment
                    <SortIcon active={ordersSort?.key === "cardBrand"} dir={ordersSort?.dir || "asc"} />
                  </th>
                )}
                {isSquare && (
                  <th
                    className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                    onClick={() => toggleSort(setOrdersSort, "diningOption")}
                  >
                    Dining
                    <SortIcon active={ordersSort?.key === "diningOption"} dir={ordersSort?.dir || "asc"} />
                  </th>
                )}
                {!isSquare && (
                  <th
                    className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                    onClick={() => toggleSort(setOrdersSort, "channel")}
                  >
                    Channel
                    <SortIcon active={ordersSort?.key === "channel"} dir={ordersSort?.dir || "asc"} />
                  </th>
                )}
                {[
                  { key: "subtotal", label: "Subtotal" },
                  { key: "tax", label: "Tax" },
                  { key: "tip", label: "Tip" },
                  { key: "fees", label: "Fees" },
                  { key: "netPayout", label: "Net Payout" },
                ].map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 font-medium text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                    onClick={() => toggleSort(setOrdersSort, col.key)}
                  >
                    {col.label}
                    <SortIcon active={ordersSort?.key === col.key} dir={ordersSort?.dir || "asc"} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedOrders.map((o) => (
                <tr key={o.id} className="border-t border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDateTime(o.datetime)}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
                    {o.orderId.length > 16 ? o.orderId.slice(0, 16) + "..." : o.orderId}
                  </td>
                  {isSquare && (
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{o.cardBrand || "Cash"}</td>
                  )}
                  {isSquare && (
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{o.diningOption || "-"}</td>
                  )}
                  {!isSquare && (
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 capitalize whitespace-nowrap">
                      {o.channel || o.fulfillmentType || "-"}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatCurrency(o.subtotal)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatCurrency(o.tax)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatCurrency(o.tip)}</td>
                  <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400 whitespace-nowrap">{formatCurrency(o.fees)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {formatCurrency(o.netPayout)}
                  </td>
                </tr>
              ))}
              {data.orders.length > 0 && (
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-medium">
                  <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 whitespace-nowrap" colSpan={isSquare ? 4 : 3}>
                    Page Total ({data.orders.length} orders)
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatCurrency(data.orders.reduce((s, o) => s + o.subtotal, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatCurrency(data.orders.reduce((s, o) => s + o.tax, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatCurrency(data.orders.reduce((s, o) => s + o.tip, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400 whitespace-nowrap">
                    {formatCurrency(data.orders.reduce((s, o) => s + o.fees, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {formatCurrency(data.orders.reduce((s, o) => s + o.netPayout, 0))}
                  </td>
                </tr>
              )}
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
