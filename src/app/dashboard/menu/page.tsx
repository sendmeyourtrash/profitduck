"use client";

import { useEffect, useState, useMemo, useCallback, Fragment } from "react";
import StatCard from "@/components/charts/StatCard";
import BarChartCard from "@/components/charts/BarChartCard";
import { formatCurrency } from "@/lib/utils/format";
import { useDateRange } from "@/contexts/DateRangeContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortDirection = "asc" | "desc";
type SortConfig = { key: string; dir: SortDirection } | null;

interface ModifierRow {
  name: string;
  count: number;
  revenue: number;
  avgPrice: number;
}

interface ItemRow {
  name: string;
  category: string;
  qty: number;
  revenue: number;
  avgPrice: number;
  platforms: string[];
  prevQty: number;
  modifiers: ModifierRow[];
}

interface CategoryRow {
  name: string;
  itemCount: number;
  qty: number;
  revenue: number;
  color: string;
  pctOfTotal: number;
}

interface ModifierAnalyticsRow {
  name: string;
  group: string;
  count: number;
  paidCount: number;
  freeCount: number;
  revenue: number;
  avgPrice: number;
  paidAvgPrice: number;
  attachRate: number;
  topItems: string[];
}

interface CrossPlatformItem {
  name: string;
  platforms: { platform: string; qty: number; revenue: number }[];
}

interface MenuData {
  summary: {
    totalItems: number;
    totalQty: number;
    totalRevenue: number;
    avgPrice: number;
    modifierRevenue: number;
    prevQty: number;
    prevRevenue: number;
    paidModCount: number;
    freeModCount: number;
    totalModSelections: number;
  };
  categories: CategoryRow[];
  items: ItemRow[];
  modifiers: ModifierAnalyticsRow[];
  crossPlatform: CrossPlatformItem[];
  dates: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  return (
    <svg
      className={`inline-block w-3 h-3 ml-1 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-300 dark:text-gray-600"}`}
      viewBox="0 0 10 14"
      fill="currentColor"
    >
      {(!active || dir === "asc") && (
        <path d="M5 0L9.33 5H0.67L5 0Z" opacity={active && dir === "asc" ? 1 : 0.4} />
      )}
      {(!active || dir === "desc") && (
        <path d="M5 14L0.67 9H9.33L5 14Z" opacity={active && dir === "desc" ? 1 : 0.4} />
      )}
    </svg>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortData<T extends Record<string, any>>(items: T[], sort: SortConfig): T[] {
  if (!sort) return items;
  return [...items].sort((a, b) => {
    const aVal = a[sort.key] ?? "";
    const bVal = b[sort.key] ?? "";
    const cmp =
      typeof aVal === "string" ? aVal.localeCompare(bVal) : (aVal as number) - (bVal as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 1000) / 10;
}

const PLATFORM_COLORS: Record<string, string> = {
  square: "#6366f1",
  doordash: "#ef4444",
  "uber-eats": "#10b981",
  grubhub: "#f59e0b",
};

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  doordash: "DoorDash",
  "uber-eats": "Uber Eats",
  grubhub: "Grubhub",
};

function PlatformDot({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform] || "#94a3b8";
  const label = PLATFORM_LABELS[platform] || platform;
  return (
    <span
      title={label}
      className="inline-block w-2 h-2 rounded-full mr-0.5"
      style={{ backgroundColor: color }}
    />
  );
}

function CategoryBadge({ name, color }: { name: string; color?: string }) {
  return (
    <span
      className="rounded-full text-[11px] font-medium px-2 py-0.5 text-white"
      style={{ backgroundColor: color || "#6366f1" }}
    >
      {name || "—"}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MenuPerformancePage() {
  const { startDate, endDate } = useDateRange();

  const [data, setData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>("");

  // Section: Items table
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [itemsVisible, setItemsVisible] = useState(10);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [itemSort, setItemSort] = useState<SortConfig>({ key: "revenue", dir: "desc" });

  // Section: Categories table
  const [catSort, setCatSort] = useState<SortConfig>({ key: "revenue", dir: "desc" });

  // Section: Modifiers table
  const [modSort, setModSort] = useState<SortConfig>({ key: "count", dir: "desc" });
  const [modVisible, setModVisible] = useState(20);
  const [modFilter, setModFilter] = useState<"all" | "paid" | "free">("all");

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

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (platformFilter) params.set("platform", platformFilter);
    fetch(`/api/dashboard/menu?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: MenuData) => {
        setData(d);
        setSelectedCategory(null);
        setItemsVisible(10);
        setExpandedItem(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [startDate, endDate, platformFilter]);

  // ── Derived data ───────────────────────────────────────────────────────────

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of data?.categories || []) map[c.name] = c.color;
    return map;
  }, [data?.categories]);

  const sortedCategories = useMemo(
    () =>
      sortData(
        (data?.categories || []).map((c) => ({
          ...c,
          avgPrice: c.qty > 0 ? c.revenue / c.qty : 0,
        })),
        catSort
      ),
    [data?.categories, catSort]
  );

  const filteredItems = useMemo(() => {
    const items = data?.items || [];
    return selectedCategory ? items.filter((i) => i.category === selectedCategory) : items;
  }, [data?.items, selectedCategory]);

  const sortedItems = useMemo(
    () =>
      sortData(
        filteredItems.map((i) => ({
          ...i,
          change: pctChange(i.qty, i.prevQty),
        })),
        itemSort
      ),
    [filteredItems, itemSort]
  );

  const sortedModifiers = useMemo(() => {
    const all = data?.modifiers || [];
    const mapped = all.map((m) => {
      if (modFilter === "paid") {
        return { ...m, count: m.paidCount, avgPrice: m.paidAvgPrice };
      } else if (modFilter === "free") {
        return { ...m, count: m.freeCount, avgPrice: 0, revenue: 0 };
      }
      return m;
    });
    const filtered =
      modFilter === "paid" ? mapped.filter((m) => m.paidCount > 0) :
      modFilter === "free" ? mapped.filter((m) => m.freeCount > 0) :
      mapped;
    return sortData(filtered, modSort);
  }, [data?.modifiers, modSort, modFilter]);

  const categoryChartData = useMemo(
    () =>
      (data?.categories || []).map((c) => ({
        name: c.name || "(Uncategorized)",
        value: c.revenue,
        color: c.color,
      })),
    [data?.categories]
  );

  // ── Loading / Error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading menu performance…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-center">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Failed to load data</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.summary.totalQty === 0) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No menu data found for this date range.
        </p>
      </div>
    );
  }

  const { summary, crossPlatform } = data;
  const qtyChange = pctChange(summary.totalQty, summary.prevQty);
  const revChange = pctChange(summary.totalRevenue, summary.prevRevenue);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Menu Performance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {summary.totalItems} unique items · {summary.totalQty.toLocaleString()} sold
          </p>
        </div>
        <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 shrink-0">
          {[
            { key: "", label: "All Platforms" },
            { key: "square", label: "Square" },
            { key: "ubereats", label: "Uber Eats" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPlatformFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                platformFilter === key
                  ? "bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Section 1: Summary Stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Items Sold"
          value={summary.totalQty.toLocaleString()}
          trend={qtyChange !== null ? { value: qtyChange, label: "vs prior period" } : undefined}
        />
        <StatCard
          title="Menu Revenue"
          value={formatCurrency(summary.totalRevenue)}
          trend={revChange !== null ? { value: revChange, label: "vs prior period" } : undefined}
        />
        <StatCard
          title="Avg Item Price"
          value={formatCurrency(summary.avgPrice)}
        />
        <StatCard
          title="Modifier Revenue"
          value={formatCurrency(summary.modifierRevenue)}
          subtitle={`${summary.paidModCount.toLocaleString()} paid, ${summary.freeModCount.toLocaleString()} free selections`}
        />
      </div>

      {/* ── Section 2: Category Performance ──────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
          Category Performance
        </h2>

        {categoryChartData.length > 0 && (
          <div className="mb-6">
            <BarChartCard
              title="Revenue by Category"
              data={categoryChartData}
              onBarClick={(name) =>
                setSelectedCategory((prev) => (prev === name ? null : name))
              }
              showPercentToggle
              valueLabel="Revenue"
            />
          </div>
        )}

        {/* Category table */}
        <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-sm">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                {(
                  [
                    { key: "name", label: "Category" },
                    { key: "itemCount", label: "Items" },
                    { key: "qty", label: "Qty" },
                    { key: "revenue", label: "Revenue" },
                    { key: "avgPrice", label: "Avg Price" },
                    { key: "pctOfTotal", label: "%" },
                  ] as { key: string; label: string }[]
                ).map(({ key, label }) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left font-medium text-[11px] cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
                    onClick={() => toggleSort(setCatSort, key)}
                  >
                    {label}
                    <SortIcon active={catSort?.key === key} dir={catSort?.dir || "asc"} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {sortedCategories.map((cat) => {
                const isSelected = selectedCategory === cat.name;
                return (
                  <tr
                    key={cat.name}
                    className={`group cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-indigo-50/50 dark:bg-indigo-900/10"
                        : ""
                    }`}
                    onClick={() =>
                      setSelectedCategory((prev) => (prev === cat.name ? null : cat.name))
                    }
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-gray-900 dark:text-gray-100 font-medium">
                          {cat.name || "(Uncategorized)"}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] text-indigo-500 font-medium">filtered</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {cat.itemCount}
                    </td>
                    <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {cat.qty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {formatCurrency(cat.revenue)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {formatCurrency(cat.avgPrice)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${cat.pctOfTotal}%`,
                              backgroundColor: cat.color,
                            }}
                          />
                        </div>
                        <span className="text-gray-500 dark:text-gray-400 text-xs">
                          {cat.pctOfTotal.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 3: Top Items ──────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Menu Items
            {selectedCategory && (
              <span className="ml-2 text-indigo-600 dark:text-indigo-400">
                — {selectedCategory}
              </span>
            )}
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {filteredItems.length} items
          </span>
        </div>

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-2 mb-4 overflow-x-auto">
          <button
            onClick={() => { setSelectedCategory(null); setItemsVisible(10); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0 ${
              selectedCategory === null
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            All
          </button>
          {(data.categories || []).map((cat) => (
            <button
              key={cat.name}
              onClick={() => {
                setSelectedCategory((prev) => (prev === cat.name ? null : cat.name));
                setItemsVisible(10);
                setExpandedItem(null);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0 ${
                selectedCategory === cat.name
                  ? "text-white"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
              style={selectedCategory === cat.name ? { backgroundColor: cat.color } : {}}
            >
              {cat.name || "(Uncategorized)"}
            </button>
          ))}
        </div>

        {/* Items table */}
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                {(
                  [
                    { key: "name", label: "Item" },
                    { key: "category", label: "Category" },
                    { key: "qty", label: "Qty" },
                    { key: "revenue", label: "Revenue" },
                    { key: "avgPrice", label: "Avg Price" },
                    { key: "change", label: "Change" },
                    { key: "platforms", label: "Platforms" },
                  ] as { key: string; label: string }[]
                ).map(({ key, label }) => (
                  <th
                    key={key}
                    className={`px-3 py-2 text-left font-medium text-[11px] whitespace-nowrap ${
                      key !== "platforms" && key !== "category"
                        ? "cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        : ""
                    }`}
                    onClick={
                      key !== "platforms" && key !== "category"
                        ? () => toggleSort(setItemSort, key)
                        : undefined
                    }
                  >
                    {label}
                    {key !== "platforms" && key !== "category" && (
                      <SortIcon active={itemSort?.key === key} dir={itemSort?.dir || "asc"} />
                    )}
                  </th>
                ))}
                <th className="px-3 py-2 w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {sortedItems.slice(0, itemsVisible).map((item) => {
                const isExpanded = expandedItem === item.name;
                const change = item.change as number | null;
                return (
                  <Fragment key={item.name}>
                    <tr
                      className={`group cursor-pointer transition-colors ${
                        isExpanded ? "bg-indigo-50/50 dark:bg-indigo-900/10" : ""
                      }`}
                      onClick={() =>
                        setExpandedItem((prev) => (prev === item.name ? null : item.name))
                      }
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {item.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        <CategoryBadge
                          name={item.category}
                          color={categoryColorMap[item.category]}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {item.qty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {formatCurrency(item.revenue)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {formatCurrency(item.avgPrice)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {change !== null ? (
                          <span
                            className={`text-xs font-medium ${
                              change >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}%
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        <div className="flex items-center gap-0.5">
                          {item.platforms.map((p) => (
                            <PlatformDot key={p} platform={p} />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        <svg
                          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </td>
                    </tr>

                    {/* Expanded modifier sub-table */}
                    {isExpanded && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-3 bg-indigo-50/50 dark:bg-indigo-900/10"
                        >
                          {item.modifiers.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500 pl-2">
                              No modifier data for this item.
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-[480px] w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400 dark:text-gray-500">
                                    <th className="px-2 py-1 text-left font-medium">Modifier</th>
                                    <th className="px-2 py-1 text-left font-medium">Times Added</th>
                                    <th className="px-2 py-1 text-left font-medium">Revenue</th>
                                    <th className="px-2 py-1 text-left font-medium">Avg Price</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-indigo-100 dark:divide-indigo-900/30">
                                  {item.modifiers.map((mod) => (
                                    <tr key={mod.name}>
                                      <td className="px-2 py-1.5 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                        {mod.name}
                                      </td>
                                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        {mod.count.toLocaleString()}
                                      </td>
                                      <td className="px-2 py-1.5 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                        {formatCurrency(mod.revenue)}
                                      </td>
                                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        {formatCurrency(mod.avgPrice)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Show more */}
        {sortedItems.length > itemsVisible && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setItemsVisible((v) => v + 10)}
              className="px-4 py-2 text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Show 10 more ({sortedItems.length - itemsVisible} remaining)
            </button>
          </div>
        )}
      </div>

      {/* ── Section 4: Modifier Analytics ────────────────────────────────── */}
      {data.modifiers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Modifier Analytics
              </h2>
              {summary.totalModSelections > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {modFilter === "all" ? (
                    <>
                      {Math.round((summary.paidModCount / summary.totalModSelections) * 100)}% paid
                      upgrades generating{" "}
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {formatCurrency(summary.modifierRevenue)}
                      </span>
                    </>
                  ) : modFilter === "paid" ? (
                    <>
                      {summary.paidModCount.toLocaleString()} paid selections ·{" "}
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {formatCurrency(summary.modifierRevenue)}
                      </span>{" "}revenue
                    </>
                  ) : (
                    <>
                      {summary.freeModCount.toLocaleString()} free selections · no revenue impact
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 shrink-0">
              {(["all", "paid", "free"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setModFilter(f); setModVisible(20); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    modFilter === f
                      ? "bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  {f === "all" ? "All" : f === "paid" ? `Paid (${summary.paidModCount})` : `Free (${summary.freeModCount})`}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                  {(
                    [
                      { key: "name", label: "Modifier" },
                      { key: "count", label: "Times Added" },
                      { key: "revenue", label: "Revenue" },
                      { key: "avgPrice", label: "Avg Price" },
                      { key: "attachRate", label: "Attach Rate" },
                    ] as { key: string; label: string }[]
                  ).map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-3 py-2 text-left font-medium text-[11px] cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
                      onClick={() => toggleSort(setModSort, key)}
                    >
                      {label}
                      <SortIcon active={modSort?.key === key} dir={modSort?.dir || "asc"} />
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-medium text-[11px] whitespace-nowrap text-gray-500 dark:text-gray-400">
                    Top Items
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {sortedModifiers.slice(0, modVisible).map((mod) => (
                  <tr key={mod.name} className="group">
                    <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {mod.name}
                        </span>
                        {mod.group && (
                          <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                            {mod.group}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {mod.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {formatCurrency(mod.revenue)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      {formatCurrency(mod.avgPrice)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      <span
                        className={`text-xs font-medium ${
                          mod.attachRate > 50
                            ? "text-emerald-600 dark:text-emerald-400"
                            : mod.attachRate > 20
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {mod.attachRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                      <div className="flex flex-col gap-0.5">
                        {mod.topItems.map((item) => (
                          <span
                            key={item}
                            className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sortedModifiers.length > modVisible && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setModVisible((v) => v + 20)}
                className="px-4 py-2 text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Show more ({sortedModifiers.length - modVisible} remaining)
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Section 5: Cross-Platform Comparison ─────────────────────────── */}
      {crossPlatform.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
            Cross-Platform Items
          </h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            {crossPlatform.length} items sold on multiple platforms · highlighted rows show 3x+ volume
            disparity
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium text-[11px] whitespace-nowrap align-bottom">
                    Item
                  </th>
                  <th colSpan={2} className="px-3 py-1 text-center font-medium text-[11px] whitespace-nowrap border-b border-gray-100 dark:border-gray-700/50">
                    Square
                  </th>
                  <th colSpan={2} className="px-3 py-1 text-center font-medium text-[11px] whitespace-nowrap border-b border-gray-100 dark:border-gray-700/50">
                    Uber Eats
                  </th>
                  <th rowSpan={2} className="px-3 py-2 text-left font-medium text-[11px] whitespace-nowrap align-bottom">
                    Total
                  </th>
                </tr>
                <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-200/50 dark:border-gray-700/50">
                  <th className="px-3 py-1 text-left font-medium text-[10px] whitespace-nowrap">Qty</th>
                  <th className="px-3 py-1 text-left font-medium text-[10px] whitespace-nowrap">Revenue</th>
                  <th className="px-3 py-1 text-left font-medium text-[10px] whitespace-nowrap">Qty</th>
                  <th className="px-3 py-1 text-left font-medium text-[10px] whitespace-nowrap">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {crossPlatform.map((row) => {
                  const sq = row.platforms.find((p) => p.platform === "square");
                  const ue = row.platforms.find((p) => p.platform === "uber-eats");
                  const totalRev = row.platforms.reduce((s, p) => s + p.revenue, 0);
                  const sqQty = sq?.qty || 0;
                  const ueQty = ue?.qty || 0;
                  const isDisparity =
                    sqQty > 0 && ueQty > 0
                      ? Math.max(sqQty, ueQty) / Math.min(sqQty, ueQty) >= 3
                      : false;
                  return (
                    <tr
                      key={row.name}
                      className={`group ${
                        isDisparity
                          ? "bg-amber-50/50 dark:bg-amber-900/10"
                          : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        <div className="flex items-center gap-2">
                          {isDisparity && (
                            <span className="text-amber-500 text-xs" title="High disparity between platforms">
                              ⚠
                            </span>
                          )}
                          {row.name}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {sqQty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {sq ? formatCurrency(sq.revenue) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {ueQty.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {ue ? formatCurrency(ue.revenue) : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap group-hover:bg-gray-50 dark:group-hover:bg-gray-700/30">
                        {formatCurrency(totalRev)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
