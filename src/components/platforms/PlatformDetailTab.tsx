"use client";

import { Fragment, useEffect, useState, useMemo, useCallback } from "react";
import StatCard from "@/components/charts/StatCard";
import RevenueChart from "@/components/charts/RevenueChart";
import ExpandedOrderRow, {
  type ExpandableOrder,
  type OrderItem,
} from "@/components/orders/ExpandedOrderRow";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PlatformDetailTabProps {
  selectedPlatforms: string[]; // empty = all platforms
  startDate: string | null;
  endDate: string | null;
}

type SortDirection = "asc" | "desc";
type SortConfig = { key: string; dir: SortDirection } | null;

interface FeeBreakdown {
  commission: number;
  processing: number;
  delivery: number;
  marketing: number;
}

interface PlatformDetailData {
  platform: string;
  orderCount: number;
  grossRevenue: number;
  totalFees: number;
  netPayout: number;
  commissionRate: number;
  avgOrderValue: number;
  tips: number;
  feeBreakdown: FeeBreakdown;
  dailyRevenue: { date: string; total: number; orders: number }[];
  orders: (ExpandableOrder & {
    orderId: string;
    datetime: string;
    subtotal: number;
    fees: number;
    netPayout: number;
    cardBrand?: string;
    diningOption?: string;
    channel?: string;
    fulfillmentType?: string;
    order_items?: OrderItem[];
  })[];
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
  categoryBreakdown?: {
    category: string;
    qty: number;
    revenue: number;
    itemCount: number;
  }[];
  modifierAnalytics?: {
    name: string;
    group: string;
    count: number;
    revenue: number;
    avgPrice: number;
    pctOfOrders: number;
  }[];
  totalItemsWithModifiers?: number;
  totalModifierRevenue?: number;
}

// Merged view built from one or more platform responses
interface MergedData {
  orderCount: number;
  grossRevenue: number;
  totalFees: number;
  netPayout: number;
  commissionRate: number;
  avgOrderValue: number;
  tips: number;
  feeBreakdown: FeeBreakdown;
  dailyRevenue: { date: string; total: number; orders: number }[];
  orders: PlatformDetailData["orders"];
  totalOrders: number;
  paymentTypeBreakdown: NonNullable<PlatformDetailData["paymentTypeBreakdown"]>;
  orderTypeBreakdown: (NonNullable<
    PlatformDetailData["orderTypeBreakdown"]
  >[number] & { pct: number })[];
  diningOptionBreakdown: NonNullable<PlatformDetailData["diningOptionBreakdown"]>;
  topItems: (NonNullable<PlatformDetailData["topItems"]>[number] & {
    avgPrice: number;
  })[];
  categoryBreakdown: (NonNullable<
    PlatformDetailData["categoryBreakdown"]
  >[number] & { pct: number })[];
  modifierAnalytics: NonNullable<PlatformDetailData["modifierAnalytics"]>;
  totalModifierRevenue: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_PLATFORMS = ["square", "doordash", "ubereats", "grubhub"] as const;

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
};

const PLATFORM_COLORS: Record<string, string> = {
  square: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  doordash: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  ubereats:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  grubhub:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  return (
    <svg
      className={`inline-block w-3 h-3 ml-1 ${
        active
          ? "text-indigo-600 dark:text-indigo-400"
          : "text-gray-300 dark:text-gray-600"
      }`}
      viewBox="0 0 10 14"
      fill="currentColor"
    >
      {(!active || dir === "asc") && (
        <path
          d="M5 0L9.33 5H0.67L5 0Z"
          opacity={active && dir === "asc" ? 1 : 0.4}
        />
      )}
      {(!active || dir === "desc") && (
        <path
          d="M5 14L0.67 9H9.33L5 14Z"
          opacity={active && dir === "desc" ? 1 : 0.4}
        />
      )}
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortData<T extends Record<string, any>>(
  items: T[],
  sort: SortConfig
): T[] {
  if (!sort) return items;
  return [...items].sort((a, b) => {
    const aVal = a[sort.key] ?? "";
    const bVal = b[sort.key] ?? "";
    const cmp =
      typeof aVal === "string"
        ? aVal.localeCompare(bVal)
        : (aVal as number) - (bVal as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

function mergeResults(results: PlatformDetailData[]): MergedData {
  // Stat card aggregation
  const totalOrders = results.reduce((s, r) => s + r.totalOrders, 0);
  const orderCount = results.reduce((s, r) => s + r.orderCount, 0);
  const grossRevenue = results.reduce((s, r) => s + r.grossRevenue, 0);
  const totalFees = results.reduce((s, r) => s + r.totalFees, 0);
  const netPayout = results.reduce((s, r) => s + r.netPayout, 0);
  const tips = results.reduce((s, r) => s + r.tips, 0);

  // Weighted avg commission rate (by gross revenue)
  const commissionRate =
    grossRevenue > 0
      ? results.reduce((s, r) => s + r.commissionRate * r.grossRevenue, 0) /
        grossRevenue
      : 0;

  // Weighted avg order value (by order count)
  const avgOrderValue =
    orderCount > 0
      ? results.reduce((s, r) => s + r.avgOrderValue * r.orderCount, 0) /
        orderCount
      : 0;

  // Fee breakdown: sum each type
  const feeBreakdown: FeeBreakdown = {
    commission: results.reduce((s, r) => s + r.feeBreakdown.commission, 0),
    processing: results.reduce((s, r) => s + r.feeBreakdown.processing, 0),
    delivery: results.reduce((s, r) => s + r.feeBreakdown.delivery, 0),
    marketing: results.reduce((s, r) => s + r.feeBreakdown.marketing, 0),
  };

  // Daily revenue: group by date, sum
  const dailyMap = new Map<
    string,
    { date: string; total: number; orders: number }
  >();
  for (const r of results) {
    for (const d of r.dailyRevenue) {
      const existing = dailyMap.get(d.date);
      if (existing) {
        existing.total += d.total;
        existing.orders += d.orders;
      } else {
        dailyMap.set(d.date, { date: d.date, total: d.total, orders: d.orders });
      }
    }
  }
  const dailyRevenue = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Payment type: concat (Square only, so no true merging needed)
  const paymentTypeBreakdown = results.flatMap(
    (r) => r.paymentTypeBreakdown ?? []
  );

  // Order type: merge by type
  const orderTypeMap = new Map<
    string,
    { type: string; count: number; revenue: number; netPayout: number; fees: number }
  >();
  for (const r of results) {
    for (const o of r.orderTypeBreakdown ?? []) {
      const existing = orderTypeMap.get(o.type);
      if (existing) {
        existing.count += o.count;
        existing.revenue += o.revenue;
        existing.netPayout += o.netPayout;
        existing.fees += o.fees;
      } else {
        orderTypeMap.set(o.type, { ...o });
      }
    }
  }
  const orderTypeRev = Array.from(orderTypeMap.values()).reduce(
    (s, o) => s + o.revenue,
    0
  );
  const orderTypeBreakdown = Array.from(orderTypeMap.values()).map((o) => ({
    ...o,
    pct: orderTypeRev > 0 ? (o.revenue / orderTypeRev) * 100 : 0,
  }));

  // Dining options: merge by option
  const diningMap = new Map<
    string,
    { option: string; count: number; revenue: number }
  >();
  for (const r of results) {
    for (const d of r.diningOptionBreakdown ?? []) {
      const existing = diningMap.get(d.option);
      if (existing) {
        existing.count += d.count;
        existing.revenue += d.revenue;
      } else {
        diningMap.set(d.option, { ...d });
      }
    }
  }
  const diningOptionBreakdown = Array.from(diningMap.values());

  // Top items: merge by name
  const itemMap = new Map<
    string,
    { name: string; category: string; qty: number; revenue: number }
  >();
  for (const r of results) {
    for (const item of r.topItems ?? []) {
      const existing = itemMap.get(item.name);
      if (existing) {
        existing.qty += item.qty;
        existing.revenue += item.revenue;
      } else {
        itemMap.set(item.name, { ...item });
      }
    }
  }
  const topItems = Array.from(itemMap.values()).map((item) => ({
    ...item,
    avgPrice: item.qty > 0 ? item.revenue / item.qty : 0,
  }));

  // Categories: merge by category
  const catMap = new Map<
    string,
    { category: string; qty: number; revenue: number; itemCount: number }
  >();
  for (const r of results) {
    for (const c of r.categoryBreakdown ?? []) {
      const existing = catMap.get(c.category);
      if (existing) {
        existing.qty += c.qty;
        existing.revenue += c.revenue;
        existing.itemCount += c.itemCount;
      } else {
        catMap.set(c.category, { ...c });
      }
    }
  }
  const catTotalRev = Array.from(catMap.values()).reduce(
    (s, c) => s + c.revenue,
    0
  );
  const categoryBreakdown = Array.from(catMap.values()).map((c) => ({
    ...c,
    pct: catTotalRev > 0 ? (c.revenue / catTotalRev) * 100 : 0,
  }));

  // Modifiers: merge by name
  const modMap = new Map<
    string,
    {
      name: string;
      group: string;
      count: number;
      revenue: number;
      totalOrders: number;
    }
  >();
  for (const r of results) {
    const rOrders = r.orderCount;
    for (const mod of r.modifierAnalytics ?? []) {
      const key = `${mod.group}|||${mod.name}`;
      const existing = modMap.get(key);
      if (existing) {
        existing.count += mod.count;
        existing.revenue += mod.revenue;
        // pctOfOrders is relative to per-platform order count — accumulate weighted
        existing.totalOrders += rOrders;
      } else {
        modMap.set(key, {
          name: mod.name,
          group: mod.group,
          count: mod.count,
          revenue: mod.revenue,
          totalOrders: rOrders,
        });
      }
    }
  }
  const modifierAnalytics = Array.from(modMap.values()).map((mod) => ({
    name: mod.name,
    group: mod.group,
    count: mod.count,
    revenue: mod.revenue,
    avgPrice: mod.count > 0 ? mod.revenue / mod.count : 0,
    pctOfOrders:
      mod.totalOrders > 0
        ? Math.round((mod.count / mod.totalOrders) * 100)
        : 0,
  }));

  const totalModifierRevenue = results.reduce(
    (s, r) => s + (r.totalModifierRevenue ?? 0),
    0
  );

  // Orders: concat all, sort by datetime DESC, take first 50
  const allOrders = results.flatMap((r) => r.orders);
  allOrders.sort(
    (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
  );
  const orders = allOrders.slice(0, 50);

  return {
    orderCount,
    grossRevenue,
    totalFees,
    netPayout,
    commissionRate: Math.round(commissionRate * 10) / 10,
    avgOrderValue,
    tips,
    feeBreakdown,
    dailyRevenue,
    orders,
    totalOrders,
    paymentTypeBreakdown,
    orderTypeBreakdown,
    diningOptionBreakdown,
    topItems,
    categoryBreakdown,
    modifierAnalytics,
    totalModifierRevenue,
  };
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PlatformDetailTab({
  selectedPlatforms,
  startDate,
  endDate,
}: PlatformDetailTabProps) {
  const platforms =
    selectedPlatforms.length > 0
      ? selectedPlatforms
      : (ALL_PLATFORMS as unknown as string[]);
  const isMulti = platforms.length > 1;

  const [merged, setMerged] = useState<MergedData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [itemsVisible, setItemsVisible] = useState(10);
  const [modifiersVisible, setModifiersVisible] = useState(10);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Sort state per table
  const [paymentSort, setPaymentSort] = useState<SortConfig>(null);
  const [orderTypeSort, setOrderTypeSort] = useState<SortConfig>(null);
  const [categorySort, setCategorySort] = useState<SortConfig>(null);
  const [topItemsSort, setTopItemsSort] = useState<SortConfig>(null);
  const [ordersSort, setOrdersSort] = useState<SortConfig>(null);
  const [modifierSort, setModifierSort] = useState<SortConfig>(null);
  const [diningSort, setDiningSort] = useState<SortConfig>(null);

  const toggleSort = useCallback(
    (setter: React.Dispatch<React.SetStateAction<SortConfig>>, key: string) => {
      setter((prev) => {
        if (prev?.key === key) {
          return prev.dir === "asc" ? { key, dir: "desc" } : null;
        }
        return { key, dir: "asc" };
      });
    },
    []
  );

  // Fetch on dependency change
  useEffect(() => {
    if (merged) setRefreshing(true);
    else setInitialLoading(true);
    setItemsVisible(10);
    setModifiersVisible(10);
    setExpanded(new Set());

    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", "0");
    params.set("limit", "50");
    const query = params.toString();

    Promise.all(
      platforms.map((p) =>
        fetch(`/api/dashboard/platforms/${p}?${query}`)
          .then((r) => r.json())
          .catch(() => null)
      )
    )
      .then((results) => {
        const valid = results.filter(
          (r): r is PlatformDetailData => r !== null && typeof r === "object"
        );
        if (valid.length > 0) {
          setMerged(mergeResults(valid));
        } else {
          setMerged(null);
        }
      })
      .finally(() => {
        setInitialLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platforms.join(","), startDate, endDate]);

  // Sorted data
  const sortedTopItems = useMemo(
    () => sortData(merged?.topItems ?? [], topItemsSort),
    [merged?.topItems, topItemsSort]
  );
  const sortedCategories = useMemo(
    () => sortData(merged?.categoryBreakdown ?? [], categorySort),
    [merged?.categoryBreakdown, categorySort]
  );
  const sortedPayments = useMemo(
    () => sortData(merged?.paymentTypeBreakdown ?? [], paymentSort),
    [merged?.paymentTypeBreakdown, paymentSort]
  );
  const sortedOrderTypes = useMemo(
    () => sortData(merged?.orderTypeBreakdown ?? [], orderTypeSort),
    [merged?.orderTypeBreakdown, orderTypeSort]
  );
  const sortedModifiers = useMemo(
    () => sortData(merged?.modifierAnalytics ?? [], modifierSort),
    [merged?.modifierAnalytics, modifierSort]
  );
  const sortedOrders = useMemo(
    () => sortData(merged?.orders ?? [], ordersSort),
    [merged?.orders, ordersSort]
  );
  const sortedDining = useMemo(
    () => sortData(merged?.diningOptionBreakdown ?? [], diningSort),
    [merged?.diningOptionBreakdown, diningSort]
  );

  // ── Loading ──
  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // ── Empty ──
  if (!merged || merged.orderCount === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p className="text-lg">No data for selected platforms</p>
        <p className="mt-2">Try selecting a different date range.</p>
      </div>
    );
  }

  const hasFees = Object.values(merged.feeBreakdown).some((v) => v > 0);
  const chartTitle = isMulti
    ? "All Platforms — Daily Revenue"
    : `${PLATFORM_LABELS[platforms[0]] ?? platforms[0]} — Daily Revenue`;

  // ColSpan for expanded order row: Date + (Platform?) + Order ID + Type + Subtotal + Tax + Tip + Fees + Net Payout
  const colSpanBase = 8;
  const orderTableColSpan = isMulti ? colSpanBase + 1 : colSpanBase;

  return (
    <div
      className={`space-y-6 transition-opacity duration-150 ${
        refreshing ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      {/* ── 1. Stat Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Net Payout"
          value={formatCurrency(merged.netPayout)}
          variant="success"
        />
        <StatCard
          title="Total Orders"
          value={merged.orderCount.toLocaleString()}
        />
        <StatCard
          title="Commission Rate"
          value={`${merged.commissionRate}%`}
          variant={
            merged.commissionRate <= 15
              ? "success"
              : merged.commissionRate <= 25
              ? "warning"
              : "danger"
          }
        />
        <StatCard
          title="Avg Order"
          value={formatCurrency(merged.avgOrderValue)}
        />
      </div>

      {/* ── 2. Daily Revenue Chart ── */}
      {merged.dailyRevenue.length > 0 && (
        <RevenueChart
          data={merged.dailyRevenue.map((d) => ({
            date: d.date,
            total: d.total,
          }))}
          title={chartTitle}
        />
      )}

      {/* ── 3. Fee Breakdown ── */}
      {hasFees && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Fee Breakdown
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(merged.feeBreakdown)
              .filter(([, v]) => v > 0)
              .map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                    {key}
                  </p>
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                    {formatCurrency(value)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── 4. Order Type Breakdown ── */}
      {merged.orderTypeBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Order Type Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
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
                      className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 whitespace-nowrap ${
                        col.right ? "text-right" : ""
                      }`}
                      onClick={() => toggleSort(setOrderTypeSort, col.key)}
                    >
                      {col.label}
                      <SortIcon
                        active={orderTypeSort?.key === col.key}
                        dir={orderTypeSort?.dir || "asc"}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const totalRev = merged.orderTypeBreakdown.reduce(
                    (s, o) => s + o.revenue,
                    0
                  );
                  return (
                    <>
                      {sortedOrderTypes.map((o) => (
                        <tr
                          key={o.type}
                          className="border-b border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="py-2 text-gray-800 dark:text-gray-200 font-medium capitalize whitespace-nowrap">
                            {o.type || "-"}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {o.count}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {formatCurrency(o.revenue)}
                          </td>
                          <td className="py-2 text-right text-red-600 dark:text-red-400 whitespace-nowrap">
                            {formatCurrency(o.fees)}
                          </td>
                          <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                            {formatCurrency(o.netPayout)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {o.pct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                        <td className="py-2 text-gray-800 dark:text-gray-200">
                          Total
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {merged.orderTypeBreakdown.reduce(
                            (s, o) => s + o.count,
                            0
                          )}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(totalRev)}
                        </td>
                        <td className="py-2 text-right text-red-600 dark:text-red-400">
                          {formatCurrency(
                            merged.orderTypeBreakdown.reduce(
                              (s, o) => s + o.fees,
                              0
                            )
                          )}
                        </td>
                        <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(
                            merged.orderTypeBreakdown.reduce(
                              (s, o) => s + o.netPayout,
                              0
                            )
                          )}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          100%
                        </td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 5. Dining Options ── */}
      {merged.diningOptionBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Dining Options
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {sortedDining.map((d) => (
              <div
                key={d.option}
                className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4"
              >
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {d.option}
                </p>
                <p className="text-xl font-bold text-gray-800 dark:text-gray-200">
                  {d.count}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatCurrency(d.revenue)} revenue
                </p>
              </div>
            ))}
          </div>
          {/* Sort controls */}
          <div className="flex gap-2 text-xs text-gray-400 dark:text-gray-500">
            {["option", "count", "revenue"].map((key) => (
              <button
                key={key}
                className={`px-2 py-0.5 rounded-lg transition-colors ${
                  diningSort?.key === key
                    ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                    : "hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
                onClick={() => toggleSort(setDiningSort, key)}
              >
                Sort by {key}
                <SortIcon
                  active={diningSort?.key === key}
                  dir={diningSort?.dir || "asc"}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. Payment Type Breakdown (Square only) ── */}
      {merged.paymentTypeBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Cash vs Credit Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
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
                      className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 whitespace-nowrap ${
                        col.right ? "text-right" : ""
                      }`}
                      onClick={() => toggleSort(setPaymentSort, col.key)}
                    >
                      {col.label}
                      <SortIcon
                        active={paymentSort?.key === col.key}
                        dir={paymentSort?.dir || "asc"}
                      />
                    </th>
                  ))}
                  <th className="pb-2 font-medium text-right whitespace-nowrap">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const total = merged.paymentTypeBreakdown.reduce(
                    (s, p) => s + p.total,
                    0
                  );
                  return (
                    <>
                      {sortedPayments.map((p) => (
                        <tr
                          key={p.type}
                          className="border-b border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="py-2 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  p.type === "Cash"
                                    ? "bg-green-500"
                                    : "bg-indigo-500"
                                }`}
                              />
                              {p.type}
                            </span>
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {p.count}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {formatCurrency(p.subtotal)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {formatCurrency(p.tax)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {formatCurrency(p.tip)}
                          </td>
                          <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                            {formatCurrency(p.total)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {total > 0
                              ? ((p.total / total) * 100).toFixed(1)
                              : "0"}
                            %
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                        <td className="py-2 text-gray-800 dark:text-gray-200">
                          Total
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {merged.paymentTypeBreakdown.reduce(
                            (s, p) => s + p.count,
                            0
                          )}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(
                            merged.paymentTypeBreakdown.reduce(
                              (s, p) => s + p.subtotal,
                              0
                            )
                          )}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(
                            merged.paymentTypeBreakdown.reduce(
                              (s, p) => s + p.tax,
                              0
                            )
                          )}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {formatCurrency(
                            merged.paymentTypeBreakdown.reduce(
                              (s, p) => s + p.tip,
                              0
                            )
                          )}
                        </td>
                        <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">
                          {formatCurrency(total)}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          100%
                        </td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 7. Revenue by Menu Category ── */}
      {merged.categoryBreakdown.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Revenue by Menu Category
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
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
                      className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 whitespace-nowrap ${
                        col.right ? "text-right" : ""
                      }`}
                      onClick={() => toggleSort(setCategorySort, col.key)}
                    >
                      {col.label}
                      <SortIcon
                        active={categorySort?.key === col.key}
                        dir={categorySort?.dir || "asc"}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const totalRev = merged.categoryBreakdown.reduce(
                    (s, c) => s + c.revenue,
                    0
                  );
                  const totalQty = merged.categoryBreakdown.reduce(
                    (s, c) => s + c.qty,
                    0
                  );
                  return (
                    <>
                      {sortedCategories.map((c) => (
                        <tr
                          key={c.category}
                          className="border-b border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="py-2 text-gray-800 dark:text-gray-200 font-medium">
                            {c.category}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                            {c.qty}
                          </td>
                          <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">
                            {formatCurrency(c.revenue)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                            {c.pct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                        <td className="py-2 text-gray-800 dark:text-gray-200">
                          Total
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          {totalQty}
                        </td>
                        <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">
                          {formatCurrency(totalRev)}
                        </td>
                        <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                          100%
                        </td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 8. Top Selling Items ── */}
      {merged.topItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Top Selling Items ({merged.topItems.length})
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
                      className={`pb-2 px-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap ${
                        col.right ? "text-right" : ""
                      }`}
                      onClick={() => toggleSort(setTopItemsSort, col.key)}
                    >
                      {col.label}
                      <SortIcon
                        active={topItemsSort?.key === col.key}
                        dir={topItemsSort?.dir || "asc"}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTopItems.slice(0, itemsVisible).map((item) => (
                  <tr
                    key={item.name}
                    className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                      {item.name}
                    </td>
                    <td className="py-2 px-3">
                      {item.category && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {item.category}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.qty}
                    </td>
                    <td className="py-2 px-3 text-right font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">
                      {formatCurrency(item.revenue)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatCurrency(item.avgPrice)}
                    </td>
                  </tr>
                ))}
                {(() => {
                  const totalQty = merged.topItems.reduce(
                    (s, i) => s + i.qty,
                    0
                  );
                  const totalRev = merged.topItems.reduce(
                    (s, i) => s + i.revenue,
                    0
                  );
                  return (
                    <tr className="border-t border-gray-200 dark:border-gray-700 font-medium">
                      <td className="py-2 px-3 text-gray-800 dark:text-gray-200">
                        Total
                      </td>
                      <td className="py-2 px-3" />
                      <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                        {totalQty}
                      </td>
                      <td className="py-2 px-3 text-right font-medium text-gray-800 dark:text-gray-200">
                        {formatCurrency(totalRev)}
                      </td>
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

      {/* ── 9. Popular Modifiers ── */}
      {merged.modifierAnalytics.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Popular Modifiers ({merged.modifierAnalytics.length})
            </h3>
            {merged.totalModifierRevenue > 0 && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                +{formatCurrency(merged.totalModifierRevenue)} modifier revenue
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
                      className={`pb-2 px-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap ${
                        col.right ? "text-right" : ""
                      }`}
                      onClick={() => toggleSort(setModifierSort, col.key)}
                    >
                      {col.label}
                      <SortIcon
                        active={modifierSort?.key === col.key}
                        dir={modifierSort?.dir || "asc"}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedModifiers.slice(0, modifiersVisible).map((mod) => (
                  <tr
                    key={`${mod.group}-${mod.name}`}
                    className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="py-2 px-3 text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                      {mod.name}
                    </td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                      {mod.group || "-"}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {mod.count}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {mod.revenue > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          +{formatCurrency(mod.revenue)}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">
                          $0.00
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {mod.avgPrice > 0 ? formatCurrency(mod.avgPrice) : "Free"}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          mod.pctOfOrders >= 20
                            ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        }`}
                      >
                        {mod.pctOfOrders}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedModifiers.length > modifiersVisible && (
            <button
              onClick={() => setModifiersVisible((v) => v + 10)}
              className="mt-3 w-full text-center text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium py-2 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              Show 10 more ({sortedModifiers.length - modifiersVisible} remaining)
            </button>
          )}
        </div>
      )}

      {/* ── 10. Orders Table ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Orders (showing first 50 of {merged.totalOrders.toLocaleString()}{" "}
            total)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-gray-500 dark:text-gray-400">
                {/* Date */}
                <th
                  className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                  onClick={() => toggleSort(setOrdersSort, "datetime")}
                >
                  Date
                  <SortIcon
                    active={ordersSort?.key === "datetime"}
                    dir={ordersSort?.dir || "asc"}
                  />
                </th>

                {/* Platform badge — only when multiple platforms */}
                {isMulti && (
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    Platform
                  </th>
                )}

                {/* Order ID */}
                <th
                  className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                  onClick={() => toggleSort(setOrdersSort, "orderId")}
                >
                  Order ID
                  <SortIcon
                    active={ordersSort?.key === "orderId"}
                    dir={ordersSort?.dir || "asc"}
                  />
                </th>

                {/* Type */}
                <th
                  className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 whitespace-nowrap"
                  onClick={() => toggleSort(setOrdersSort, "dining_option")}
                >
                  Type
                  <SortIcon
                    active={ordersSort?.key === "dining_option"}
                    dir={ordersSort?.dir || "asc"}
                  />
                </th>

                {/* Financial columns */}
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
                    <SortIcon
                      active={ordersSort?.key === col.key}
                      dir={ordersSort?.dir || "asc"}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedOrders.map((o) => {
                const isExpanded = expanded.has(o.id);
                return (
                  <Fragment key={o.id}>
                    <tr
                      className={`border-t border-gray-100 dark:border-gray-700/50 cursor-pointer transition-colors ${
                        isExpanded
                          ? "bg-indigo-50/50 dark:bg-indigo-900/10"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                      }`}
                      onClick={() => toggleExpand(o.id)}
                    >
                      {/* Date */}
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`text-xs text-gray-400 transition-transform ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                          >
                            ▸
                          </span>
                          {formatDateTime(o.datetime)}
                        </span>
                      </td>

                      {/* Platform badge — only when multiple platforms */}
                      {isMulti && (
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              PLATFORM_COLORS[o.platform] ??
                              "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                            }`}
                          >
                            {PLATFORM_LABELS[o.platform] ?? o.platform}
                          </span>
                        </td>
                      )}

                      {/* Order ID */}
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
                        {o.orderId.length > 16
                          ? o.orderId.slice(0, 16) + "..."
                          : o.orderId}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 capitalize whitespace-nowrap">
                        {o.dining_option || o.diningOption || "-"}
                      </td>

                      {/* Financial */}
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatCurrency(o.subtotal)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatCurrency(o.tax)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatCurrency(o.tip)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400 whitespace-nowrap">
                        {formatCurrency(o.fees)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrency(o.netPayout)}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-t border-gray-100 dark:border-gray-700/50">
                        <ExpandedOrderRow
                          order={o}
                          colSpan={orderTableColSpan}
                        />
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {/* Totals row */}
              {sortedOrders.length > 0 && (
                <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-medium">
                  <td
                    className="px-4 py-2.5 text-gray-800 dark:text-gray-200 whitespace-nowrap"
                    colSpan={isMulti ? 4 : 3}
                  >
                    Showing {sortedOrders.length} orders
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatCurrency(
                      sortedOrders.reduce((s, o) => s + o.subtotal, 0)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatCurrency(sortedOrders.reduce((s, o) => s + o.tax, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {formatCurrency(sortedOrders.reduce((s, o) => s + o.tip, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400 whitespace-nowrap">
                    {formatCurrency(
                      sortedOrders.reduce((s, o) => s + o.fees, 0)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {formatCurrency(
                      sortedOrders.reduce((s, o) => s + o.netPayout, 0)
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
