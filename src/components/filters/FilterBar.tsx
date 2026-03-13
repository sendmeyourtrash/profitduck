"use client";

import { useEffect, useState, useCallback } from "react";

export interface FilterState {
  startDate: string;
  endDate: string;
  platforms: string[];
  types: string[];
  categories: string[];
  search: string;
}

interface DataRangeInfo {
  dateRange: { min: string | null; max: string | null };
  platforms: string[];
  categories: string[];
  vendors: { id: string; name: string; category: string | null }[];
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  showTypes?: boolean;
  showCategories?: boolean;
  showSearch?: boolean;
  extraContent?: React.ReactNode;
}

const TYPE_OPTIONS = [
  { value: "income", label: "Income", color: "bg-emerald-100 text-emerald-700" },
  { value: "expense", label: "Expense", color: "bg-red-100 text-red-700" },
  { value: "fee", label: "Fee", color: "bg-amber-100 text-amber-700" },
  { value: "payout", label: "Payout", color: "bg-blue-100 text-blue-700" },
  { value: "adjustment", label: "Adjustment", color: "bg-purple-100 text-purple-700" },
];

const PLATFORM_LABELS: Record<string, string> = {
  square: "Square",
  chase: "Chase",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  rocketmoney: "Rocket Money",
  manual: "Manual",
};

export const emptyFilters: FilterState = {
  startDate: "",
  endDate: "",
  platforms: [],
  types: [],
  categories: [],
  search: "",
};

export default function FilterBar({
  filters,
  onChange,
  showTypes = true,
  showCategories = true,
  showSearch = true,
  extraContent,
}: FilterBarProps) {
  const [dataRange, setDataRange] = useState<DataRangeInfo | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/data-range")
      .then((r) => r.json())
      .then(setDataRange)
      .catch(() => {});
  }, []);

  const toggleArrayFilter = useCallback(
    (key: "platforms" | "types" | "categories", value: string) => {
      const current = filters[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onChange({ ...filters, [key]: next });
    },
    [filters, onChange]
  );

  const hasActiveFilters =
    filters.startDate ||
    filters.endDate ||
    filters.platforms.length > 0 ||
    filters.types.length > 0 ||
    filters.categories.length > 0 ||
    filters.search;

  const minDate = dataRange?.dateRange.min
    ? dataRange.dateRange.min.split("T")[0]
    : undefined;
  const maxDate = dataRange?.dateRange.max
    ? dataRange.dateRange.max.split("T")[0]
    : undefined;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      {/* Top row: date range + search + toggle */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={filters.startDate}
            min={minDate}
            max={filters.endDate || maxDate}
            onChange={(e) =>
              onChange({ ...filters, startDate: e.target.value })
            }
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={filters.endDate}
            min={filters.startDate || minDate}
            max={maxDate}
            onChange={(e) =>
              onChange({ ...filters, endDate: e.target.value })
            }
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>

        {/* Quick date presets */}
        <div className="flex gap-1">
          {[
            { label: "7d", days: 7 },
            { label: "30d", days: 30 },
            { label: "90d", days: 90 },
            { label: "YTD", days: -1 },
            { label: "All", days: 0 },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                if (preset.days === 0) {
                  onChange({ ...filters, startDate: "", endDate: "" });
                } else if (preset.days === -1) {
                  const now = new Date();
                  const ytd = new Date(now.getFullYear(), 0, 1);
                  onChange({
                    ...filters,
                    startDate: ytd.toISOString().split("T")[0],
                    endDate: now.toISOString().split("T")[0],
                  });
                } else {
                  const now = new Date();
                  const start = new Date(now);
                  start.setDate(start.getDate() - preset.days);
                  onChange({
                    ...filters,
                    startDate: start.toISOString().split("T")[0],
                    endDate: now.toISOString().split("T")[0],
                  });
                }
              }}
              className="px-2 py-1.5 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {showSearch && (
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) =>
                onChange({ ...filters, search: e.target.value })
              }
              placeholder="Search descriptions..."
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-indigo-600 hover:text-indigo-700 px-3 py-1.5"
        >
          {expanded ? "Less" : "More"} filters
        </button>

        {hasActiveFilters && (
          <button
            onClick={() => onChange(emptyFilters)}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5"
          >
            Clear all
          </button>
        )}

        {extraContent}
      </div>

      {/* Expanded: platform + type + category chips */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t border-gray-100">
          {/* Platform chips */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              Platforms
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(dataRange?.platforms || []).map((p) => {
                const active = filters.platforms.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => toggleArrayFilter("platforms", p)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      active
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {PLATFORM_LABELS[p] || p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type chips */}
          {showTypes && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Types
              </label>
              <div className="flex flex-wrap gap-1.5">
                {TYPE_OPTIONS.map((t) => {
                  const active = filters.types.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      onClick={() => toggleArrayFilter("types", t.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? "bg-indigo-600 text-white"
                          : `${t.color} hover:opacity-80`
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category chips */}
          {showCategories && (dataRange?.categories || []).length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Categories
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(dataRange?.categories || []).map((c) => {
                  const active = filters.categories.includes(c!);
                  return (
                    <button
                      key={c}
                      onClick={() => toggleArrayFilter("categories", c!)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active filter summary */}
      {hasActiveFilters && !expanded && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {filters.platforms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700"
            >
              {PLATFORM_LABELS[p] || p}
              <button
                onClick={() => toggleArrayFilter("platforms", p)}
                className="hover:text-indigo-900"
              >
                x
              </button>
            </span>
          ))}
          {filters.types.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700"
            >
              {t}
              <button
                onClick={() => toggleArrayFilter("types", t)}
                className="hover:text-amber-900"
              >
                x
              </button>
            </span>
          ))}
          {filters.categories.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-700"
            >
              {c}
              <button
                onClick={() => toggleArrayFilter("categories", c)}
                className="hover:text-gray-900"
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
