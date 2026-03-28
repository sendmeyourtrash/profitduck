/**
 * Bank Activity Page — Displays bank transactions from bank.db (Rocket Money + Chase).
 *
 * Data flow:
 *   1. Global date range from DateRangeContext
 *   2. Fetches /api/bank-activity which reads from bank.db
 *   3. Account chips filter by Business Checking / Chase Ink
 *   4. Category filter by RM categories
 *
 * @see PIPELINE.md for database architecture
 */
"use client";

import React, { useEffect, useState, useCallback } from "react";
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

interface BankTransaction {
  id: string;
  date: string;
  description: string;
  rawDescription?: string;
  originalName?: string;
  customName?: string | null;
  amount: number;
  category: string;
  accountName: string;
  accountType: string;
  institutionName: string;
  taxDeductible: boolean;
  tags: string | null;
  source: string;
  note: string;
  type: string; // "deposit" or "expense"
  ignored?: boolean;
}

interface BankSummary {
  deposits: number;
  depositsCount: number;
  expenses: number;
  expensesCount: number;
  net: number;
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-800 dark:text-gray-200 mt-0.5">{value}</dd>
    </div>
  );
}

function ExpandedRow({ tx }: { tx: BankTransaction }) {
  return (
    <td colSpan={8} className="px-0 py-0">
      <div className="bg-gray-50/80 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700/50">
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-6 gap-y-2">
            <DetailField label="Account" value={
              <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {tx.accountName}
              </span>
            } />
            <DetailField label="Account Type" value={tx.accountType} />
            <DetailField label="Category" value={tx.category} />
            <DetailField label="Type" value={
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                tx.type === "deposit"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}>{tx.type}</span>
            } />
            <DetailField label="Amount" value={
              <span className={`font-medium ${tx.type === "deposit" ? "text-emerald-600" : "text-gray-800 dark:text-gray-200"}`}>
                {formatCurrency(Math.abs(tx.amount))}
              </span>
            } />
            {tx.taxDeductible && (
              <DetailField label="Tax Deductible" value={
                <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">Yes</span>
              } />
            )}
            {tx.note && <DetailField label="Note" value={tx.note} />}
            {tx.tags && (
              <DetailField label="Tags" value={
                <div className="flex gap-1 flex-wrap">
                  {tx.tags.split(",").map((tag) => (
                    <span key={tag.trim()} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              } />
            )}
          </div>
        </div>
      </div>
    </td>
  );
}

export default function BankPage() {
  const { startDate: globalStart, endDate: globalEnd } = useDateRange();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<BankSummary>({ deposits: 0, depositsCount: 0, expenses: 0, expensesCount: 0, net: 0 });
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortConfig>(null);
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<{ name: string; ignored: boolean }[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [availableVendors, setAvailableVendors] = useState<{ name: string; count: number; tag: string }[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const limit = 50;

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Bulk selection
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [bulkRenameValue, setBulkRenameValue] = useState("");

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

  const toggleAccount = useCallback((label: string) => {
    setSelectedAccounts((prev) => {
      if (prev.includes(label)) {
        return prev.filter((a) => a !== label);
      } else {
        return [...prev, label];
      }
    });
    setPage(0);
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      if (prev.includes(cat)) {
        return prev.filter((c) => c !== cat);
      } else {
        return [...prev, cat];
      }
    });
    setPage(0);
  }, []);

  const toggleVendor = useCallback((name: string) => {
    setSelectedVendors((prev) => {
      if (prev.includes(name)) {
        return prev.filter((v) => v !== name);
      } else {
        return [...prev, name];
      }
    });
    setPage(0);
  }, []);

  const fetchData = useCallback(() => {
    if (transactions.length === 0) setInitialLoading(true);
    else setRefreshing(true);
    const params = new URLSearchParams();

    selectedCategories.forEach((c) => params.append("categories", c));
    selectedAccounts.forEach((a) => params.append("accounts", a));
    selectedVendors.forEach((v) => params.append("vendors", v));
    if (globalStart) params.set("startDate", globalStart);
    if (globalEnd) params.set("endDate", globalEnd);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));
    if (sort) {
      params.set("sortBy", sort.key);
      params.set("sortDir", sort.dir);
    }

    fetch(`/api/bank-activity?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setTransactions(data.transactions);
        setTotal(data.total);
        if (data.summary) setSummary(data.summary);
        if (data.availableAccounts) setAvailableAccounts(data.availableAccounts);
        if (data.availableCategories) setAvailableCategories(data.availableCategories);
        if (data.availableVendors) setAvailableVendors(data.availableVendors);
      })
      .finally(() => { setInitialLoading(false); setRefreshing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, sort, selectedAccounts, selectedCategories, selectedVendors, globalStart, globalEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setExpanded(new Set()); setSelectedTxIds(new Set()); }, [filters, page]);

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const startRename = useCallback((tx: BankTransaction) => {
    setRenamingId(tx.id);
    setRenameValue(tx.customName || tx.originalName || tx.description || "");
  }, []);

  const saveRename = useCallback(async (id: string) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await fetch("/api/bank-activity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(id), customName: renameValue.trim() }),
    });
    setRenamingId(null);
    fetchData();
  }, [renameValue, fetchData]);

  const saveBulkRename = useCallback(async () => {
    if (!bulkRenameValue.trim() || selectedTxIds.size === 0) return;
    await fetch("/api/bank-activity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedTxIds].map(Number), customName: bulkRenameValue.trim() }),
    });
    setSelectedTxIds(new Set());
    setBulkRenameValue("");
    fetchData();
  }, [bulkRenameValue, selectedTxIds, fetchData]);

  const toggleSelectTx = useCallback((id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedTxIds.size === transactions.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(transactions.map((t) => t.id)));
    }
  }, [selectedTxIds.size, transactions]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        allowedPlatforms={[]}
        showDateRange={false}
        showTypes={false}
        showCategories={false}
        extraContent={
          <>
            <span className="text-sm text-gray-400 ml-auto">
              {total.toLocaleString()} records
            </span>
          </>
        }
      />

      {/* Account Filter */}
      {availableAccounts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Account:</span>
          {availableAccounts.map((label) => {
            const active = selectedAccounts.includes(label);
            return (
              <button
                key={label}
                onClick={() => toggleAccount(label)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:ring-blue-700"
                    : selectedAccounts.length === 0
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                    : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                }`}
              >
                {label}
              </button>
            );
          })}
          {selectedAccounts.length > 0 && (
            <button
              onClick={() => { setSelectedAccounts([]); setPage(0); }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Category Filter */}
      {availableCategories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Category:</span>
          {availableCategories.map((cat) => {
            const active = selectedCategories.includes(cat.name);
            return (
              <button
                key={cat.name}
                onClick={() => toggleCategory(cat.name)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-400 dark:ring-indigo-700"
                    : cat.ignored
                    ? "bg-amber-50 text-amber-400 line-through dark:bg-amber-900/20 dark:text-amber-500"
                    : selectedCategories.length === 0
                    ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                    : "bg-gray-50 text-gray-400 dark:bg-gray-700/50 dark:text-gray-500"
                }`}
              >
                {cat.name}
              </button>
            );
          })}
          {selectedCategories.length > 0 && (
            <button
              onClick={() => { setSelectedCategories([]); setPage(0); }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Vendor Filters — collapsible */}
      {availableVendors.length > 0 && (() => {
        const grouped = availableVendors.filter((v) => v.tag === "grouped");
        const ignored = availableVendors.filter((v) => v.tag === "ignored");
        const unmatched = availableVendors.filter((v) => v.tag === "unmatched");

        const chipColors: Record<string, { active: string; inactive: string }> = {
          grouped: { active: "bg-purple-100 text-purple-700 ring-1 ring-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:ring-purple-700", inactive: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400" },
          ignored: { active: "bg-gray-200 text-gray-600 ring-1 ring-gray-300 line-through dark:bg-gray-600 dark:text-gray-300 dark:ring-gray-500", inactive: "bg-gray-100 text-gray-400 line-through dark:bg-gray-700 dark:text-gray-500" },
          unmatched: { active: "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-700", inactive: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400" },
        };

        const renderChips = (vendors: typeof availableVendors, label: string) => {
          if (vendors.length === 0) return null;
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{label}:</span>
              {vendors.map(({ name, count, tag }) => {
                const active = selectedVendors.includes(name);
                const colors = chipColors[tag] || chipColors.unmatched;
                return (
                  <button
                    key={name}
                    onClick={() => toggleVendor(name)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                      active ? colors.active : selectedVendors.length === 0 ? colors.inactive : "bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500"
                    }`}
                    title={`${count} transactions`}
                  >
                    {name} <span className="text-[9px] opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          );
        };

        const hasActiveVendors = selectedVendors.length > 0;

        return (
          <details className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-2" open={hasActiveVendors}>
            <summary className="text-xs text-gray-500 dark:text-gray-400 font-medium cursor-pointer select-none flex items-center gap-2">
              Vendor Filters
              {hasActiveVendors && (
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] dark:bg-indigo-900/30 dark:text-indigo-400">
                  {selectedVendors.length} active
                </span>
              )}
            </summary>
            <div className="mt-2 space-y-1.5">
              {renderChips(grouped, "Vendors")}
              {renderChips(ignored, "Ignored")}
              {renderChips(unmatched, "Unmatched")}
              {selectedVendors.length > 0 && (
                <button
                  onClick={() => { setSelectedVendors([]); setPage(0); }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  Clear vendor filters
                </button>
              )}
            </div>
          </details>
        );
      })()}

      {/* Summary Cards */}
      {!initialLoading && total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Deposits</p>
            <p className="text-lg font-semibold text-emerald-600 mt-0.5">{formatCurrency(summary.deposits)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{summary.depositsCount.toLocaleString()} transactions</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Expenses</p>
            <p className="text-lg font-semibold text-red-600 mt-0.5">{formatCurrency(summary.expenses)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{summary.expensesCount.toLocaleString()} transactions</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Net</p>
            <p className={`text-lg font-semibold mt-0.5 ${summary.net <= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatCurrency(Math.abs(summary.net))}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">deposits − expenses</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700/50 overflow-hidden transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
        {initialLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            No bank transactions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedTxIds.size === transactions.length && transactions.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                  {[
                    { key: "date", label: "Date" },
                    { key: null, label: "Vendor" },
                    { key: null, label: "Description" },
                    { key: null, label: "Account" },
                    { key: "category", label: "Category" },
                    { key: null, label: "Type" },
                    { key: "amount", label: "Amount", right: true },
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
                {transactions.map((tx) => {
                  const isExpanded = expanded.has(tx.id);
                  return (
                    <React.Fragment key={tx.id}>
                      <tr
                        className={`border-t border-gray-100 dark:border-gray-700/50 cursor-pointer transition-colors ${
                          tx.ignored ? "opacity-40" : ""
                        } ${
                          selectedTxIds.has(tx.id) ? "bg-indigo-50/30 dark:bg-indigo-900/10" : ""
                        } ${
                          isExpanded ? "bg-indigo-50/50 dark:bg-indigo-900/10" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        }`}
                        onClick={() => toggleExpand(tx.id)}
                      >
                        <td className="px-2 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedTxIds.has(tx.id)}
                            onChange={() => toggleSelectTx(tx.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`text-xs text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}>&#9656;</span>
                            {formatDate(tx.date)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {renamingId === tx.id ? (
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRename(tx.id);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={() => saveRename(tx.id)}
                              className="w-full border border-indigo-300 dark:border-indigo-600 rounded px-2 py-0.5 text-sm font-medium bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              autoFocus
                            />
                          ) : (
                            <div
                              className="group cursor-text"
                              onClick={() => startRename(tx)}
                            >
                              <span className="text-gray-800 dark:text-gray-200 font-medium group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                                {tx.description || "-"}
                              </span>
                              {tx.customName && tx.originalName && tx.customName !== tx.originalName && (
                                <span className="ml-1.5 text-[10px] text-indigo-400" title="Renamed">&#9998;</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 max-w-xs truncate text-xs">
                          {tx.rawDescription && tx.rawDescription !== tx.description ? tx.rawDescription : ""}
                          {tx.taxDeductible && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">tax</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            {tx.accountName}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{tx.category || "-"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            tx.type === "deposit"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          }`}>{tx.type}</span>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-medium ${
                          tx.type === "deposit" ? "text-emerald-600" : "text-gray-800 dark:text-gray-200"
                        }`}>
                          {formatCurrency(Math.abs(tx.amount))}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${tx.id}-detail`} className="border-t border-gray-100 dark:border-gray-700/50">
                          <ExpandedRow tx={tx} />
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

      {/* Bulk Rename Bar */}
      {selectedTxIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/50 shadow-lg rounded-xl px-5 py-3 flex items-center gap-3 z-50">
          <span className="text-sm text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
            {selectedTxIds.size} selected
          </span>
          <input
            type="text"
            value={bulkRenameValue}
            onChange={(e) => setBulkRenameValue(e.target.value)}
            placeholder="Rename to..."
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm w-56 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            onKeyDown={(e) => { if (e.key === "Enter") saveBulkRename(); }}
          />
          <button
            onClick={saveBulkRename}
            disabled={!bulkRenameValue.trim()}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
          >
            Rename
          </button>
          <button
            onClick={() => { setSelectedTxIds(new Set()); setBulkRenameValue(""); }}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
