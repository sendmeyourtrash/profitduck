/**
 * Sales Page — Displays orders from all platforms via unified `orders` table in sales.db.
 */
"use client";
import { Fragment } from "react";

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

interface OrderItem {
  item_name: string;
  qty: number;
  unit_price: number;
  gross_sales: number;
  modifiers: string;
  display_name: string;
}

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


function parseModifiersJson(modifiers: string): { group: string; name: string; price: number }[] {
  if (!modifiers) return [];
  // 1. Try structured JSON: [{group, name, price}]
  try {
    const parsed = JSON.parse(modifiers);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  // 2. Semicolon-delimited with groups: "Group: Option ($1.00); Group2: Option2"
  if (modifiers.includes(";")) {
    return modifiers.split(";").flatMap(group => {
      const trimmed = group.trim();
      if (!trimmed) return [];
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) return [{ group: "", name: trimmed, price: 0 }];
      const groupName = trimmed.slice(0, colonIdx).trim();
      const optionsStr = trimmed.slice(colonIdx + 1).trim();
      return optionsStr.split(/,\s*/).map(opt => {
        const hasPrice = opt.includes("($");
        const priceMatch = opt.match(/\(\$([\d.]+)\)/);
        const name = opt.replace(/\s*\(\$[\d.]+\)/, "").trim();
        return { group: groupName, name, price: hasPrice && priceMatch ? parseFloat(priceMatch[1]) : 0 };
      }).filter(m => m.name);
    });
  }
  // 3. Simple comma-separated (Square): "Hot, Caramel, Red"
  return modifiers.split(",").map(m => m.trim()).filter(Boolean).map(name => ({
    group: "",
    name,
    price: 0,
  }));
}

function ExpandedRow({ order }: { order: Order }) {
  // Use structured order_items if available (from API), fall back to summary string
  const hasOrderItems = Array.isArray(order.order_items) && order.order_items.length > 0;

  const itemList = hasOrderItems
    ? order.order_items!.map((oi: OrderItem) => ({
        name: oi.display_name || oi.item_name,
        qty: oi.qty,
        price: oi.unit_price,
        total: oi.gross_sales,
        modifiers: parseModifiersJson(oi.modifiers),
      }))
    : order.items
      ? order.items.split(" | ").map((s) => {
          const match = s.trim().match(/^(.+)\s+x(\d+)$/);
          return match
            ? { name: match[1].trim(), qty: parseInt(match[2]), price: 0, total: 0, modifiers: [] as { group: string; name: string; price: number }[] }
            : { name: s.trim(), qty: 1, price: 0, total: 0, modifiers: [] };
        }).filter(i => i.name)
      : null;

  // Modifiers shown inline per item via order_items

  return (
    <td colSpan={8} className="px-0 py-0">
      <div className="bg-gray-50/80 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700/50">
        <div className="px-5 py-4 space-y-4">

          {/* Order Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-2">
              <div>
                <dt className="text-xs text-gray-400">Platform</dt>
                <dd className="mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${PLATFORM_COLORS[order.platform] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}>
                    {PLATFORM_LABELS[order.platform] || order.platform}
                  </span>
                </dd>
              </div>
              {order.time && (
                <div>
                  <dt className="text-xs text-gray-400">Time</dt>
                  <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5">{order.time}</dd>
                </div>
              )}
              {order.dining_option && (
                <div>
                  <dt className="text-xs text-gray-400">Order Type</dt>
                  <dd className="mt-0.5">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">{order.dining_option}</span>
                  </dd>
                </div>
              )}
              {order.payment_method && (
                <div>
                  <dt className="text-xs text-gray-400">Payment</dt>
                  <dd className="mt-0.5">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{order.payment_method}</span>
                  </dd>
                </div>
              )}
              {order.customer_name && (
                <div>
                  <dt className="text-xs text-gray-400">Customer</dt>
                  <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5">{order.customer_name}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-400">Type</dt>
                <dd className="mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[order.order_status] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"}`}>
                    {order.order_status}
                  </span>
                </dd>
              </div>
            </div>

            {/* Financial summary card — receipt style */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/50 rounded-lg px-4 py-3 min-w-[240px]">
              <div className="text-xs space-y-0">

                {/* ── SALE ── */}
                <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Sale</p>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                  <span className="text-gray-800 dark:text-gray-200">{formatCurrency(order.gross_sales)}</span>
                </div>
                {order.tax > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax</span>
                    <span className="text-gray-600 dark:text-gray-400">{formatCurrency(order.tax)}</span>
                  </div>
                )}
                {order.tip > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tip</span>
                    <span className="text-emerald-600">{formatCurrency(order.tip)}</span>
                  </div>
                )}
                {order.discounts < 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Discounts</span>
                    <span className="text-amber-600">{formatCurrency(order.discounts)}</span>
                  </div>
                )}
                <div className="border-t border-gray-100 dark:border-gray-700/50 mt-1 pt-1 flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400 font-medium">Total</span>
                  <span className="text-gray-800 dark:text-gray-200 font-medium">{formatCurrency(order.gross_sales + order.tax + (order.tip || 0) + (order.discounts || 0))}</span>
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
                    <div className="border-t border-gray-100 dark:border-gray-700/50 mt-1 pt-1 flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400 font-medium">Total Costs</span>
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
                        <span className="text-gray-600 dark:text-gray-400">Refunds</span>
                        <span className="text-red-500">{formatCurrency(order.refunds_total)}</span>
                      </div>
                    )}
                    {order.adjustments_total !== 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Adjustments</span>
                        <span className={order.adjustments_total < 0 ? "text-red-500" : "text-gray-600 dark:text-gray-400"}>{formatCurrency(order.adjustments_total)}</span>
                      </div>
                    )}
                    {order.other_total !== 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Other</span>
                        <span className={order.other_total < 0 ? "text-red-500" : "text-gray-600 dark:text-gray-400"}>{formatCurrency(order.other_total)}</span>
                      </div>
                    )}
                  </>
                )}

                {/* ── NET REVENUE ── */}
                <div className="border-t-2 border-gray-200 dark:border-gray-600 mt-3 pt-2 flex justify-between">
                  <span className="text-gray-800 dark:text-gray-200 font-semibold">Net Revenue</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">{formatCurrency(order.net_sales)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Items */}
          {itemList && itemList.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Items Ordered</h4>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/50 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                      <th className="px-3 py-1.5 font-medium">Item</th>
                      <th className="px-3 py-1.5 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemList.map((item, i) => (
                      <Fragment key={i}>
                        <tr className="border-t border-gray-50 dark:border-gray-700/50">
                          <td className="px-3 py-1.5">
                            <span className="text-gray-800 dark:text-gray-200 font-medium">{item.name}</span>
                            <span className="text-gray-400 dark:text-gray-500 ml-1 text-[10px]">x{item.qty}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300 font-medium">
                            {item.total > 0 && formatCurrency(item.total)}
                          </td>
                        </tr>
                        {item.modifiers.map((mod, j) => (
                          <tr key={`${i}-mod-${j}`}>
                            <td className="px-3 py-0.5 pl-6">
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {mod.group ? `${mod.group}: ${mod.name}` : mod.name}
                              </span>
                            </td>
                            <td className="px-3 py-0.5 text-right text-[11px] text-gray-400 dark:text-gray-500">
                              {mod.price > 0 ? `+$${mod.price.toFixed(2)}` : "$0.00"}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                  {/* Totals footer */}
                  {(() => {
                    const itemsTotal = itemList.reduce((sum, i) => sum + (i.total || 0), 0);
                    const modsTotal = itemList.reduce((sum, i) => sum + i.modifiers.reduce((ms, m) => ms + (m.price || 0), 0), 0);
                    const grandTotal = Math.round((itemsTotal + modsTotal) * 100) / 100;
                    return (
                      <tfoot className="border-t border-gray-200 dark:border-gray-600">
                        <tr>
                          <td className="px-3 py-1 text-[11px] text-gray-500 dark:text-gray-400">Items</td>
                          <td className="px-3 py-1 text-right text-[11px] text-gray-600 dark:text-gray-400">{formatCurrency(itemsTotal)}</td>
                        </tr>
                        {modsTotal > 0 && (
                          <tr>
                            <td className="px-3 py-1 text-[11px] text-gray-500 dark:text-gray-400">Modifiers</td>
                            <td className="px-3 py-1 text-right text-[11px] text-gray-600 dark:text-gray-400">+{formatCurrency(modsTotal)}</td>
                          </tr>
                        )}
                        <tr className="border-t border-gray-200 dark:border-gray-600">
                          <td className="px-3 py-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">Total</td>
                          <td className="px-3 py-1.5 text-right text-xs font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(grandTotal)}</td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            </div>
          )}

          {/* Order ID footer */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-700/50 text-[10px] text-gray-400">
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
                          <ExpandedRow order={order} />
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
