"use client";

import { useEffect, useState, useCallback } from "react";

export interface FilterState {
  startDate: string;
  endDate: string;
  platforms: string[];
  types: string[];
  categories: string[];
  statuses: string[];
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
  showDateRange?: boolean;
  showTypes?: boolean;
  showStatuses?: boolean;
  showCategories?: boolean;
  showSearch?: boolean;
  extraContent?: React.ReactNode;
  /** When set, only these platforms appear in the filter chips */
  allowedPlatforms?: string[];
}

const TYPE_OPTIONS = [
  { value: "completed", label: "Completed", color: "bg-emerald-100 text-emerald-700" },
  { value: "fees_total", label: "Fees", color: "bg-red-100 text-red-700" },
  { value: "marketing_total", label: "Marketing", color: "bg-amber-100 text-amber-700" },
  { value: "refunds_total", label: "Refunds", color: "bg-orange-100 text-orange-700" },
  { value: "cancelled", label: "Cancelled", color: "bg-rose-100 text-rose-700" },
  { value: "unfulfilled", label: "Unfulfilled", color: "bg-slate-100 text-slate-700" },
  { value: "adjustments_total", label: "Adjustments", color: "bg-purple-100 text-purple-700" },
  { value: "other_total", label: "Other", color: "bg-gray-100 text-gray-700" },
];

const STATUS_OPTIONS = [
  { value: "completed", label: "Completed", color: "bg-emerald-100 text-emerald-700" },
  { value: "refund", label: "Refund", color: "bg-orange-100 text-orange-700" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-100 text-red-700" },
  { value: "adjustment", label: "Adjustment", color: "bg-purple-100 text-purple-700" },
  { value: "credit", label: "Credit", color: "bg-blue-100 text-blue-700" },
  { value: "other", label: "Other", color: "bg-gray-100 text-gray-700" },
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
  statuses: [],
  search: "",
};

export default function FilterBar({
  filters,
  onChange,
  showDateRange = true,
  showTypes = true,
  showStatuses = false,
  showCategories = true,
  showSearch = true,
  extraContent,
  allowedPlatforms,
}: FilterBarProps) {
  const [dataRange, setDataRange] = useState<DataRangeInfo | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Scope categories to allowedPlatforms so only relevant categories appear
    const params = new URLSearchParams();
    if (allowedPlatforms) {
      for (const p of allowedPlatforms) {
        params.append("platforms", p);
      }
    }
    const qs = params.toString();
    fetch(`/api/data-range${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then(setDataRange)
      .catch(() => {});
  }, [allowedPlatforms]);

  const toggleArrayFilter = useCallback(
    (key: "platforms" | "types" | "categories" | "statuses", value: string) => {
      const current = filters[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onChange({ ...filters, [key]: next });
    },
    [filters, onChange]
  );

  const hasActiveFilters =
    (showDateRange && (filters.startDate || filters.endDate)) ||
    filters.platforms.length > 0 ||
    filters.types.length > 0 ||
    filters.statuses.length > 0 ||
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
        {showDateRange && (
          <>
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
                { label: "1Y", days: 365 },
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
          </>
        )}

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

      {/* Platform chips — always visible (hidden when allowedPlatforms is empty) */}
      {(dataRange?.platforms || []).length > 0 && (!allowedPlatforms || allowedPlatforms.length > 0) && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-gray-500 mr-1">Platforms:</span>
          {(dataRange?.platforms || []).filter((p) => !allowedPlatforms || allowedPlatforms.includes(p)).map((p) => {
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
      )}

      {/* Expanded: type + category chips */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t border-gray-100">
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

          {/* Status chips */}
          {showStatuses && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Status
              </label>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((s) => {
                  const active = filters.statuses.includes(s.value);
                  return (
                    <button
                      key={s.value}
                      onClick={() => toggleArrayFilter("statuses", s.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        active
                          ? "bg-indigo-600 text-white"
                          : `${s.color} hover:opacity-80`
                      }`}
                    >
                      {s.label}
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
          {filters.statuses.map((s) => {
            const opt = STATUS_OPTIONS.find((o) => o.value === s);
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700"
              >
                {opt?.label || s}
                <button
                  onClick={() => toggleArrayFilter("statuses", s)}
                  className="hover:text-emerald-900"
                >
                  x
                </button>
              </span>
            );
          })}
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
