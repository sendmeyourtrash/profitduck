/**
 * Sales Page — Displays orders from all platforms via unified `orders` table in sales.db.
 */
"use client";
import { Fragment } from "react";

import React, { useEffect, useState, useCallback } from "react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";
import FilterBar, {
  FilterState,
  emptyFilters,
} from "@/components/filters/FilterBar";
import ExpandedOrderRow, { parseModifiersJson as _parseModifiersJson, type OrderItem, type ExpandableOrder } from "@/components/orders/ExpandedOrderRow";

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

interface Order extends ExpandableOrder {
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
  order_items?: OrderItem[];
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
  square: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  doordash: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  ubereats: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  grubhub: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  refund: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  unfulfilled: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
  other: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
  adjustment: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  credit: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  error_charge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const SALES_PLATFORMS = ["square", "doordash", "ubereats", "grubhub"];

const parseModifiersJson = _parseModifiersJson;

export default function SalesPage() {
  const { startDate: globalStart, endDate: globalEnd } = useDateRange();
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [platformSummary, setPlatformSummary] = useState<PlatformSummary | null>(null);
  const [cashSummary, setCashSummary] = useState<{ orderCount: number; grossSales: number; tax: number; tip: number; netSales: number } | null>(null);
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
        setCashSummary(data.cashSummary || null);
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
      {!initialLoading && total > 0 && ps && (() => {
        const gross = ps.grossSales || 1;
        const pct = (v: number) => `${Math.abs(Math.round((v / gross) * 1000) / 10)}%`;
        const netRevenue = ps.grossSales + (ps.feesTotal || 0) + (ps.marketingTotal || 0) + (ps.discounts || 0);
        return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Gross Sales</p>
            <p className="text-lg font-semibold text-emerald-600 mt-0.5">{formatCurrency(ps.grossSales)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{ps.orderCount.toLocaleString()} orders</p>
            {cashSummary && cashSummary.orderCount > 0 && (
              <p className="text-[10px] text-emerald-500 mt-0.5 border-t border-gray-100 dark:border-gray-700/50 pt-1">
                💵 Cash: {formatCurrency(cashSummary.grossSales)} <span className="text-gray-400">({cashSummary.orderCount} orders)</span>
              </p>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Fees</p>
            <p className="text-lg font-semibold text-red-500 mt-0.5">
              {formatCurrency(ps.feesTotal)} <span className="text-xs font-normal text-gray-400">{pct(ps.feesTotal)}</span>
            </p>
            <div className="text-[10px] text-gray-400 mt-0.5 space-y-0.5">
              {ps.commissionFee !== 0 && <p>Commission: {formatCurrency(ps.commissionFee)} <span className="text-gray-300 dark:text-gray-500">{pct(ps.commissionFee)}</span></p>}
              {ps.processingFee !== 0 && <p>Processing: {formatCurrency(ps.processingFee)} <span className="text-gray-300 dark:text-gray-500">{pct(ps.processingFee)}</span></p>}
              {ps.deliveryFee !== 0 && <p>Delivery: {formatCurrency(ps.deliveryFee)} <span className="text-gray-300 dark:text-gray-500">{pct(ps.deliveryFee)}</span></p>}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Marketing</p>
            <p className="text-lg font-semibold text-amber-600 mt-0.5">
              {formatCurrency(ps.marketingTotal)} <span className="text-xs font-normal text-gray-400">{pct(ps.marketingTotal)}</span>
            </p>
            {ps.discounts !== 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5">Discounts: {formatCurrency(ps.discounts)} <span className="text-gray-300 dark:text-gray-500">{pct(ps.discounts)}</span></p>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Tax Collected</p>
            <p className="text-lg font-semibold text-gray-700 dark:text-gray-300 mt-0.5">
              {formatCurrency(ps.tax)} <span className="text-xs font-normal text-gray-400">{pct(ps.tax)}</span>
            </p>
            {ps.tip > 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5">Tips: {formatCurrency(ps.tip)} <span className="text-gray-300 dark:text-gray-500">{pct(ps.tip)}</span></p>
            )}
            {cashSummary && cashSummary.tax > 0 && (
              <p className="text-[10px] text-emerald-500 mt-0.5 border-t border-gray-100 dark:border-gray-700/50 pt-1">
                💵 Cash tax: {formatCurrency(cashSummary.tax)}
              </p>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Net Revenue</p>
            <p className={`text-lg font-semibold mt-0.5 ${netRevenue >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatCurrency(netRevenue)} <span className="text-xs font-normal text-gray-400">{pct(netRevenue)}</span>
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">after fees & marketing</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 border-t border-gray-100 dark:border-gray-700/50 pt-1">
              After tax: <span className="font-medium">{formatCurrency(netRevenue - (ps.tax || 0))}</span> <span className="text-gray-300 dark:text-gray-500">{pct(netRevenue - (ps.tax || 0))}</span>
            </p>
            {cashSummary && cashSummary.netSales > 0 && (
              <p className="text-[10px] text-emerald-500 mt-0.5">
                💵 Cash net: {formatCurrency(cashSummary.netSales)}
              </p>
            )}
          </div>
        </div>
        );
      })()}

      {/* Table */}
      <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 overflow-hidden transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
        {initialLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            No sales found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr className="text-left text-gray-500 dark:text-gray-400">
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
                      className={`px-4 py-3 font-medium ${col.right ? "text-right" : ""} ${col.key ? "cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" : ""}`}
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
                  // Strip ~modifiers~ from preview, show first item + count
                  const cleanItems = order.items?.replace(/\s*~[^~]*~/g, "") || "";
                  const itemParts = cleanItems ? cleanItems.split(" | ").filter(Boolean) : [];
                  const itemPreview = itemParts.length > 1
                    ? `${itemParts[0]} +${itemParts.length - 1}`
                    : itemParts[0] || "-";

                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`border-t border-gray-100 dark:border-gray-700/50 cursor-pointer transition-colors ${
                          isExpanded ? "bg-indigo-50/50 dark:bg-indigo-900/10" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        }`}
                        onClick={() => toggleExpand(order.id)}
                      >
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`text-xs text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}>▸</span>
                            {formatDate(order.date)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 max-w-xs truncate" title={order.items || ""}>
                          {itemPreview}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${PLATFORM_COLORS[order.platform] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}>
                            {PLATFORM_LABELS[order.platform] || order.platform}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs">{order.payment_method || "-"}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs capitalize">{order.dining_option || "-"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[order.order_status] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}>
                            {order.order_status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-emerald-600">
                          {formatCurrency(order.gross_sales)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium ${order.net_sales >= 0 ? "text-gray-800 dark:text-gray-200" : "text-red-600"}`}>
                          {formatCurrency(order.net_sales)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${order.id}-detail`} className="border-t border-gray-100 dark:border-gray-700/50">
                          <ExpandedOrderRow order={order} colSpan={8} />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="border-t border-gray-100 dark:border-gray-700/50 px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
