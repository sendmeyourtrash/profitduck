/**
 * Sales Page — Displays orders from all platforms via unified `orders` table in sales.db.
 */
"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";
import FilterBar, {
  FilterState,
  emptyFilters,
} from "@/components/filters/FilterBar";

type SortDirection = "asc" | "desc";
type SortConfig = { key: string; dir: SortDirection } | null;

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  return (
    <svg className={`inline-block w-3 h-3 ml-1 ${active ? "text-indigo-600" : "text-gray-300"}`} viewBox="0 0 10 14" fill="currentColor">
      {(!active || dir === "asc") && <path d="M5 0L9.33 5H0.67L5 0Z" opacity={active && dir === "asc" ? 1 : 0.4} />}
      {(!active || dir === "desc") && <path d="M5 14L0.67 9H9.33L5 14Z" opacity={active && dir === "desc" ? 1 : 0.4} />}
    </svg>
  );
}

// ── Types matching the new API shape ──

interface Order {
  id: string;
  date: string;
  time: string | null;
  platform: string;
  order_id: string;
  order_status: string;
  gross_sales: number;
  tax: number;
  tip: number;
  net_sales: number;
  items: string | null;
  item_count: number | null;
  modifiers: string | null;
  discounts: number;
  dining_option: string | null;
  customer_name: string | null;
  payment_method: string | null;
  commission_fee: number;
  processing_fee: number;
  delivery_fee: number;
  marketing_fee: number;
  fees_total: number;
  marketing_total: number;
  refunds_total: number;
  adjustments_total: number;
  other_total: number;
}

interface PlatformSummary {
  orderCount: number;
  grossSales: number;
  tax: number;
  tip: number;
  netSales: number;
  commissionFee: number;
  processingFee: number;
  deliveryFee: number;
  marketingFee: number;
  feesTotal: number;
  marketingTotal: number;
  refundsTotal: number;
  adjustmentsTotal: number;
  otherTotal: number;
  discounts: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
};

const PLATFORM_COLORS: Record<string, string> = {
  square: "bg-blue-100 text-blue-700",
  doordash: "bg-red-100 text-red-700",
  ubereats: "bg-green-100 text-green-700",
  grubhub: "bg-orange-100 text-orange-700",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  refund: "bg-amber-100 text-amber-700",
  unfulfilled: "bg-gray-100 text-gray-600",
  other: "bg-gray-100 text-gray-600",
  adjustment: "bg-purple-100 text-purple-700",
  credit: "bg-blue-100 text-blue-700",
  error_charge: "bg-red-100 text-red-700",
};

const SALES_PLATFORMS = ["square", "doordash", "ubereats", "grubhub"];

function FeeRow({ label, value }: { label: string; value: number }) {
  if (!value || Math.abs(value) < 0.01) return null;
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={value < 0 ? "text-red-500" : "text-gray-600"}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function ExpandedRow({ order }: { order: Order }) {
  // Parse items string: "Item1 x1 | Item2 x2"
  const itemList = order.items
    ? order.items.split(" | ").map((s) => {
        const match = s.match(/^(.+)\s+x(\d+)$/);
        return match ? { name: match[1], qty: parseInt(match[2]) } : { name: s, qty: 1 };
      })
    : null;

  // Parse modifiers string
  const modList = order.modifiers
    ? order.modifiers.split(" | ").filter(Boolean)
    : null;

  return (
    <td colSpan={8} className="px-0 py-0">
      <div className="bg-gray-50/80 border-t border-gray-100">
        <div className="px-5 py-4 space-y-4">

          {/* Order Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-2">
              <div>
                <dt className="text-xs text-gray-400">Platform</dt>
                <dd className="mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${PLATFORM_COLORS[order.platform] || "bg-gray-100 text-gray-600"}`}>
                    {PLATFORM_LABELS[order.platform] || order.platform}
                  </span>
                </dd>
              </div>
              {order.time && (
                <div>
                  <dt className="text-xs text-gray-400">Time</dt>
                  <dd className="text-sm text-gray-800 mt-0.5">{order.time}</dd>
                </div>
              )}
              {order.dining_option && (
                <div>
                  <dt className="text-xs text-gray-400">Order Type</dt>
                  <dd className="mt-0.5">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">{order.dining_option}</span>
                  </dd>
                </div>
              )}
              {order.payment_method && (
                <div>
                  <dt className="text-xs text-gray-400">Payment</dt>
                  <dd className="mt-0.5">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">{order.payment_method}</span>
                  </dd>
                </div>
              )}
              {order.customer_name && (
                <div>
                  <dt className="text-xs text-gray-400">Customer</dt>
                  <dd className="text-sm text-gray-800 mt-0.5">{order.customer_name}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-400">Type</dt>
                <dd className="mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[order.order_status] || "bg-gray-100 text-gray-600"}`}>
                    {order.order_status}
                  </span>
                </dd>
              </div>
            </div>

            {/* Financial summary card — receipt style */}
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 min-w-[240px]">
              <div className="text-xs space-y-0">

                {/* ── SALE ── */}
                <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Sale</p>
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-800">{formatCurrency(order.gross_sales)}</span>
                </div>
                {order.tax > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax</span>
                    <span className="text-gray-600">{formatCurrency(order.tax)}</span>
                  </div>
                )}
                {order.tip > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tip</span>
                    <span className="text-emerald-600">{formatCurrency(order.tip)}</span>
                  </div>
                )}
                {order.discounts < 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Discounts</span>
                    <span className="text-amber-600">{formatCurrency(order.discounts)}</span>
                  </div>
                )}
                <div className="border-t border-gray-100 mt-1 pt-1 flex justify-between">
                  <span className="text-gray-500 font-medium">Total</span>
                  <span className="text-gray-800 font-medium">{formatCurrency(order.gross_sales + order.tax + (order.tip || 0) + (order.discounts || 0))}</span>
                </div>

                {/* ── PLATFORM COSTS ── */}
                {(order.fees_total !== 0 || order.marketing_total !== 0) && (
                  <>
                    <div className="mt-3" />
                    <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Platform Costs</p>
                    <FeeRow label="Commission" value={order.commission_fee} />
                    <FeeRow label="Processing" value={order.processing_fee} />
                    <FeeRow label="Delivery" value={order.delivery_fee} />
                    <FeeRow label="Marketing" value={order.marketing_fee || order.marketing_total} />
                    <div className="border-t border-gray-100 mt-1 pt-1 flex justify-between">
                      <span className="text-gray-500 font-medium">Total Costs</span>
                      <span className="text-red-500 font-medium">{formatCurrency((order.fees_total || 0) + (order.marketing_total || 0))}</span>
                    </div>
                  </>
                )}

                {/* ── ADJUSTMENTS ── */}
                {(order.refunds_total !== 0 || order.adjustments_total !== 0 || order.other_total !== 0) && (
                  <>
                    <div className="mt-3" />
                    <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Adjustments</p>
                    {order.refunds_total !== 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Refunds</span>
                        <span className="text-red-500">{formatCurrency(order.refunds_total)}</span>
                      </div>
                    )}
                    {order.adjustments_total !== 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Adjustments</span>
                        <span className={order.adjustments_total < 0 ? "text-red-500" : "text-gray-600"}>{formatCurrency(order.adjustments_total)}</span>
                      </div>
                    )}
                    {order.other_total !== 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Other</span>
                        <span className={order.other_total < 0 ? "text-red-500" : "text-gray-600"}>{formatCurrency(order.other_total)}</span>
                      </div>
                    )}
                  </>
                )}

                {/* ── NET REVENUE ── */}
                <div className="border-t-2 border-gray-200 mt-3 pt-2 flex justify-between">
                  <span className="text-gray-800 font-semibold">Net Revenue</span>
                  <span className="text-emerald-700 font-bold text-sm">{formatCurrency(order.net_sales)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Items */}
          {itemList && itemList.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Items Ordered</h4>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="px-3 py-1.5 font-medium">Item</th>
                      <th className="px-3 py-1.5 font-medium text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemList.map((item, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 text-gray-800 font-medium">{item.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-600">{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modifiers */}
          {modList && modList.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Modifiers</h4>
              <div className="flex flex-wrap gap-1">
                {modList.map((mod, i) => (
                  <span key={i} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{mod}</span>
                ))}
              </div>
            </div>
          )}

          {/* Order ID footer */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 text-[10px] text-gray-400">
            {order.order_id && (
              <span className="font-mono" title={order.order_id}>
                ID: {order.order_id.length > 30 ? order.order_id.slice(0, 30) + "..." : order.order_id}
              </span>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}

export default function SalesPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    }>
      <SalesPage />
    </Suspense>
  );
}

function SalesPage() {
  const { startDate: globalStart, endDate: globalEnd } = useDateRange();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [platformSummary, setPlatformSummary] = useState<PlatformSummary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortConfig>(null);
  const limit = 50;

  const toggleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return prev.dir === "asc" ? { key, dir: "desc" } : null;
      }
      return { key, dir: "asc" };
    });
    setPage(0);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const fetchData = useCallback(() => {
    if (orders.length === 0) setInitialLoading(true);
    else setRefreshing(true);
    const params = new URLSearchParams();

    const activePlatforms = filters.platforms.length > 0
      ? filters.platforms.filter((p) => SALES_PLATFORMS.includes(p))
      : SALES_PLATFORMS;
    activePlatforms.forEach((p) => params.append("platforms", p));

    // Types filter (fees_total, marketing_total, refunds_total, adjustments_total, other_total)
    if (filters.types.length > 0) {
      filters.types.forEach((t) => params.append("types", t));
    }

    // Status filter (order_status)
    if (filters.statuses.length > 0) {
      filters.statuses.forEach((s) => params.append("statuses", s));
    }

    // Category filter (display_category from order_items)
    if (filters.categories.length > 0) {
      filters.categories.forEach((c) => params.append("categories", c));
    }

    if (globalStart) params.set("startDate", globalStart);
    if (globalEnd) params.set("endDate", globalEnd);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));
    if (sort) {
      params.set("sortBy", sort.key);
      params.set("sortDir", sort.dir);
    }

    fetch(`/api/transactions?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.transactions || []);
        setTotal(data.total || 0);
        setPlatformSummary(data.platformSummary || null);
      })
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, sort, globalStart, globalEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setExpanded(new Set()); }, [filters, page]);

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const totalPages = Math.ceil(total / limit);
  const ps = platformSummary;

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        allowedPlatforms={SALES_PLATFORMS}
        showDateRange={false}
        showStatuses={false}
        extraContent={
          <span className="text-sm text-gray-400 ml-auto">
            {total.toLocaleString()} orders
          </span>
        }
      />

      {/* Summary Cards */}
      {!initialLoading && total > 0 && ps && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Gross Sales</p>
            <p className="text-lg font-semibold text-emerald-600 mt-0.5">{formatCurrency(ps.grossSales)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{ps.orderCount.toLocaleString()} orders</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Fees</p>
            <p className="text-lg font-semibold text-red-500 mt-0.5">{formatCurrency(ps.feesTotal)}</p>
            <div className="text-[10px] text-gray-400 mt-0.5 space-y-0.5">
              {ps.commissionFee !== 0 && <p>Commission: {formatCurrency(ps.commissionFee)}</p>}
              {ps.processingFee !== 0 && <p>Processing: {formatCurrency(ps.processingFee)}</p>}
              {ps.deliveryFee !== 0 && <p>Delivery: {formatCurrency(ps.deliveryFee)}</p>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Marketing</p>
            <p className="text-lg font-semibold text-amber-600 mt-0.5">{formatCurrency(ps.marketingTotal)}</p>
            {ps.discounts !== 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5">Discounts: {formatCurrency(ps.discounts)}</p>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Tax Collected</p>
            <p className="text-lg font-semibold text-gray-700 mt-0.5">{formatCurrency(ps.tax)}</p>
            {ps.tip > 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5">Tips: {formatCurrency(ps.tip)}</p>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Net Revenue</p>
            <p className={`text-lg font-semibold mt-0.5 ${(ps.grossSales + (ps.feesTotal || 0) + (ps.marketingTotal || 0) + (ps.discounts || 0)) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatCurrency(ps.grossSales + (ps.feesTotal || 0) + (ps.marketingTotal || 0) + (ps.discounts || 0))}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">after fees & marketing</p>
            <p className="text-[10px] text-gray-500 mt-1 border-t border-gray-100 pt-1">
              After tax: <span className="font-medium">{formatCurrency(ps.grossSales + (ps.feesTotal || 0) + (ps.marketingTotal || 0) + (ps.discounts || 0) - (ps.tax || 0))}</span>
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
        {initialLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            No sales found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  {[
                    { key: "date", label: "Date" },
                    { key: null, label: "Items" },
                    { key: "platform", label: "Platform" },
                    { key: null, label: "Payment" },
                    { key: null, label: "Order Type" },
                    { key: null, label: "Type" },
                    { key: "amount", label: "Gross", right: true },
                    { key: "net", label: "Net", right: true },
                  ].map((col) => (
                    <th
                      key={col.label}
                      className={`px-4 py-3 font-medium ${col.right ? "text-right" : ""} ${col.key ? "cursor-pointer select-none hover:text-gray-700" : ""}`}
                      onClick={col.key ? () => toggleSort(col.key!) : undefined}
                    >
                      {col.label}
                      {col.key && <SortIcon active={sort?.key === col.key} dir={sort?.key === col.key ? sort.dir : "asc"} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isExpanded = expanded.has(order.id);
                  // Show first item or item count
                  const itemPreview = order.items
                    ? order.items.split(" | ").length > 1
                      ? `${order.items.split(" | ")[0]} +${order.items.split(" | ").length - 1}`
                      : order.items.split(" | ")[0]
                    : "-";

                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        className={`border-t border-gray-100 cursor-pointer transition-colors ${
                          isExpanded ? "bg-indigo-50/50" : "hover:bg-gray-50"
                        }`}
                        onClick={() => toggleExpand(order.id)}
                      >
                        <td className="px-4 py-2.5 text-gray-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`text-xs text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}>▸</span>
                            {formatDate(order.date)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-800 max-w-xs truncate" title={order.items || ""}>
                          {itemPreview}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${PLATFORM_COLORS[order.platform] || "bg-gray-100 text-gray-600"}`}>
                            {PLATFORM_LABELS[order.platform] || order.platform}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">{order.payment_method || "-"}</td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs capitalize">{order.dining_option || "-"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[order.order_status] || "bg-gray-100 text-gray-600"}`}>
                            {order.order_status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-emerald-600">
                          {formatCurrency(order.gross_sales)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium ${order.net_sales >= 0 ? "text-gray-800" : "text-red-600"}`}>
                          {formatCurrency(order.net_sales)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${order.id}-detail`} className="border-t border-gray-100">
                          <ExpandedRow order={order} />
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
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
