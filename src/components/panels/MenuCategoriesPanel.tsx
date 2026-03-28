"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";

// ---------- Types ----------

interface CategoryItem {
  displayName: string;
  qty: number;
  revenue: number;
}

interface Category {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  itemCount: number;
  revenue: number;
  items: CategoryItem[];
}

interface UnmappedItem {
  displayName: string;
  qty: number;
  revenue: number;
  rawCategory: string;
  suggestion: { categoryId: string; categoryName: string; score: number } | null;
}

interface Stats {
  totalCategories: number;
  mappedItems: number;
  unmappedItems: number;
}

// ---------- Default category colors ----------

const DEFAULT_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

function getCatColor(cat: Category, index: number): string {
  return cat.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

// ---------- Component ----------

export default function MenuCategoriesPanel() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([]);
  const [stats, setStats] = useState<Stats>({ totalCategories: 0, mappedItems: 0, unmappedItems: 0 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null);

  // Expanded category (click to expand inline)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Setup flow
  const [suggestions, setSuggestions] = useState<{ name: string; itemCount: number; qty: number }[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [newCustom, setNewCustom] = useState("");

  // Catalog sync
  const [catalogSyncing, setCatalogSyncing] = useState(false);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add category
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Edit category
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  // Assign picker for unmapped items
  const [assigningItem, setAssigningItem] = useState<string | null>(null);

  // ---------- Data ----------

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/menu-categories");
      const data = await res.json();
      setCategories(data.categories || []);
      setUnmapped(data.unmapped || []);
      setStats(data.stats || { totalCategories: 0, mappedItems: 0, unmappedItems: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (message) {
      const delay = message.type === "error" ? 6000 : 3000;
      const t = setTimeout(() => setMessage(null), delay);
      return () => clearTimeout(t);
    }
  }, [message]);

  // ---------- Computed ----------

  const totalRevenue = useMemo(
    () => categories.reduce((s, c) => s + c.revenue, 0),
    [categories]
  );

  const totalItems = stats.mappedItems + stats.unmappedItems;

  const filteredUnmapped = useMemo(() => {
    if (!search) return unmapped;
    const q = search.toLowerCase();
    return unmapped.filter((i) => i.displayName.toLowerCase().includes(q));
  }, [unmapped, search]);

  // ---------- Actions ----------

  const loadSuggestions = async () => {
    const res = await fetch("/api/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "suggest" }),
    });
    const data = await res.json();
    const suggs = data.suggestions || [];
    setSuggestions(suggs);
    setSelectedSuggestions(new Set(suggs.map((s: { name: string }) => s.name)));
  };

  const seedCategories = async () => {
    const names = [...selectedSuggestions, ...customCategories.filter((c) => c.trim())];
    if (!names.length) return;
    const res = await fetch("/api/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seed", categoryNames: names }),
    });
    const data = await res.json();
    if (res.ok) {
      setSuggestions(null);
      setCustomCategories([]);
      setMessage({ text: `Created ${data.categoriesCreated} categories`, type: "success" });
      fetchData(true);
    }
  };

  const toggleSuggestion = (name: string) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const addCustomCategory = () => {
    if (!newCustom.trim()) return;
    setCustomCategories((prev) => [...prev, newCustom.trim()]);
    setNewCustom("");
  };

  const addCategory = async () => {
    if (!newCategoryName.trim()) return;
    const res = await fetch("/api/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-category", name: newCategoryName }),
    });
    if (res.ok) {
      setNewCategoryName(""); setShowAddCategory(false);
      setMessage({ text: `Created "${newCategoryName}"`, type: "success" });
      fetchData(true);
    } else {
      const data = await res.json();
      setMessage({ text: data.error || "Failed", type: "info" });
    }
  };

  const saveEditCategory = async () => {
    if (!editingCategoryId || !editCategoryName.trim()) return;
    await fetch("/api/menu-categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingCategoryId, name: editCategoryName }),
    });
    setEditingCategoryId(null);
    setMessage({ text: "Category renamed", type: "success" });
    fetchData(true);
  };

  const deleteCategoryAction = async (id: string, name: string) => {
    await fetch(`/api/menu-categories?id=${id}`, { method: "DELETE" });
    if (expandedId === id) setExpandedId(null);
    setMessage({ text: `Deleted "${name}"`, type: "info" });
    fetchData(true);
  };

  const assignItem = async (displayName: string, categoryId: string) => {
    setAssigningItem(null);
    await fetch("/api/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", displayName, categoryId }),
    });
    setMessage({ text: `Assigned "${displayName}"`, type: "success" });
    fetchData(true);
  };

  const unassignItem = async (displayName: string) => {
    await fetch("/api/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unassign", displayName }),
    });
    setMessage({ text: `Removed "${displayName}"`, type: "info" });
    fetchData(true);
  };

  const resetAll = async () => {
    await fetch("/api/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
    setExpandedId(null);
    setMessage({ text: "All categories and mappings cleared", type: "info" });
    fetchData(true);
  };

  const syncFromSquare = async () => {
    setCatalogSyncing(true);
    try {
      const res = await fetch("/api/square/catalog", { method: "POST" });
      const data = await res.json();
      if (data.operationId) {
        const es = new EventSource(`/api/progress/${data.operationId}`);
        es.onmessage = (event) => {
          try {
            const progress = JSON.parse(event.data);
            if (progress.done) {
              es.close();
              if (progress.error) {
                setMessage({ text: progress.error, type: "error" });
              } else {
                const r = progress.result || {};
                setMessage({
                  text: `Synced: ${r.categoriesCreated || 0} categories, ${r.itemsMapped || 0} items mapped`,
                  type: "success",
                });
              }
              fetchData(true);
              setCatalogSyncing(false);
            }
          } catch { /* ignore */ }
        };
        es.onerror = () => {
          es.close();
          setMessage({ text: "Lost connection during sync", type: "error" });
          setCatalogSyncing(false);
          fetchData(true);
        };
      } else {
        setMessage({ text: data.error || "Catalog sync failed", type: "error" });
        setCatalogSyncing(false);
      }
    } catch {
      setMessage({ text: "Failed to sync from Square", type: "error" });
      setCatalogSyncing(false);
    }
  };

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // ========== SETUP STATE ==========
  if (categories.length === 0) {
    if (suggestions !== null) {
      return (
        <div className="max-w-lg mx-auto py-8 space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200">Select Your Categories</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Uncheck any you don&apos;t want, add your own below.
            </p>
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">From Your Data</h4>
              {suggestions.map((s) => (
                <label key={s.name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.has(s.name)}
                    onChange={() => toggleSuggestion(s.name)}
                    className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 w-4 h-4"
                  />
                  <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{s.name}</span>
                  <span className="text-xs text-gray-400">{s.itemCount} items</span>
                </label>
              ))}
            </div>
          )}

          {suggestions.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No categories found in your data. Add your own below.</p>
          )}

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Add Custom</h4>
            {customCategories.map((c, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">{c}</span>
                <button onClick={() => setCustomCategories((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs text-gray-400 hover:text-red-500 p-1">✕</button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text" value={newCustom}
                onChange={(e) => setNewCustom(e.target.value)}
                placeholder="e.g. Appetizers, Desserts..."
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                onKeyDown={(e) => { if (e.key === "Enter") addCustomCategory(); }}
              />
              <button onClick={addCustomCategory} disabled={!newCustom.trim()}
                className="px-4 py-2.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors">
                Add
              </button>
            </div>
          </div>

          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={seedCategories}
              disabled={selectedSuggestions.size === 0 && customCategories.length === 0}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all font-medium shadow-sm hover:shadow-md"
            >
              Create {selectedSuggestions.size + customCategories.length} Categories
            </button>
            <button
              onClick={() => setSuggestions(null)}
              className="px-4 py-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors text-sm"
            >
              Back
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="text-center py-16 space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Set Up Menu Categories</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mt-2">
            Group your menu items into categories to unlock revenue breakdowns, trends, and insights.
          </p>
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <button
            onClick={syncFromSquare}
            disabled={catalogSyncing}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-medium shadow-sm hover:shadow-md disabled:opacity-50"
          >
            {catalogSyncing ? "Syncing..." : "Sync from Square"}
          </button>
          <button
            onClick={loadSuggestions}
            className="px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all font-medium border border-gray-200 dark:border-gray-700"
          >
            Suggest from My Data
          </button>
          <button
            onClick={() => { setSuggestions([]); }}
            className="px-6 py-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all font-medium border border-gray-200 dark:border-gray-700"
          >
            Start from Scratch
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-sm mx-auto">
          Sync from Square pulls your real menu categories directly from your POS.
        </p>
      </div>
    );
  }

  // ========== MAIN VIEW ==========
  return (
    <div className="space-y-5">
      {/* Toast */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          message.type === "success" ? "bg-emerald-600 text-white" : message.type === "error" ? "bg-red-600 text-white" : "bg-gray-800 text-white"
        }`}>
          {message.text}
        </div>
      )}

      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.mappedItems}</span>
              <span className="text-sm text-gray-400">/ {totalItems} items categorized</span>
            </div>
            {/* Progress bar */}
            <div className="w-48 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                style={{ width: `${totalItems > 0 ? (stats.mappedItems / totalItems) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={syncFromSquare}
            disabled={catalogSyncing}
            className="text-xs px-3 py-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            {catalogSyncing ? "Syncing..." : "Sync from Square"}
          </button>
          <button
            onClick={() => { setShowAddCategory(true); setNewCategoryName(""); }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            + New Category
          </button>
          <button
            onClick={resetAll}
            className="text-xs px-3 py-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Add category form */}
      {showAddCategory && (
        <div className="flex gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
          <input
            type="text" value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name..."
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") addCategory();
              if (e.key === "Escape") setShowAddCategory(false);
            }}
          />
          <button onClick={addCategory} disabled={!newCategoryName.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium transition-colors">
            Create
          </button>
          <button onClick={() => setShowAddCategory(false)}
            className="px-3 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* Two-column layout: Categories left, Unmapped right */}
      <div className="flex gap-6 flex-col md:flex-row">

        {/* Left: Categories list */}
        <div className="md:w-1/2 space-y-1">
          {/* Revenue breakdown bar */}
          {totalRevenue > 0 && (
            <div className="rounded-full overflow-hidden flex h-2 mb-3" title="Revenue by category">
              {categories.filter(c => c.revenue > 0).map((cat, i) => (
                <div
                  key={cat.id}
                  className="h-full transition-all duration-300 hover:opacity-80 cursor-pointer"
                  style={{
                    width: `${(cat.revenue / totalRevenue) * 100}%`,
                    backgroundColor: getCatColor(cat, i),
                    minWidth: cat.revenue > 0 ? "4px" : "0",
                  }}
                  title={`${cat.name}: ${formatCurrency(cat.revenue)} (${Math.round((cat.revenue / totalRevenue) * 100)}%)`}
                  onClick={() => setExpandedId(expandedId === cat.id ? null : cat.id)}
                />
              ))}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-visible">
            {categories.map((cat, i) => {
              const color = getCatColor(cat, i);
              const isExpanded = expandedId === cat.id;
              const pct = totalRevenue > 0 ? Math.round((cat.revenue / totalRevenue) * 100) : 0;

              return (
                <div key={cat.id} className="group border-b border-gray-100 dark:border-gray-700/50 last:border-b-0">
                  {/* Row header */}
                  <div
                    className="flex items-center px-4 py-3 cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                  >
                    {/* Expand chevron */}
                    <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 mr-2 shrink-0 ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>

                    {/* Color dot */}
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 mr-3" style={{ backgroundColor: color }} />

                    {/* Name + edit */}
                    <div className="flex-1 min-w-0">
                      {editingCategoryId === cat.id ? (
                        <div className="flex gap-2 items-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            value={editCategoryName}
                            onChange={(e) => setEditCategoryName(e.target.value)}
                            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditCategory();
                              if (e.key === "Escape") setEditingCategoryId(null);
                            }}
                          />
                          <button onClick={saveEditCategory} className="text-xs text-emerald-600 font-medium px-2 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors">Save</button>
                          <button onClick={() => setEditingCategoryId(null)} className="text-xs text-gray-400 px-1">✕</button>
                        </div>
                      ) : (
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate block">{cat.name}</span>
                      )}
                    </div>

                    {/* Stats */}
                    <span className="text-xs text-gray-400 shrink-0 mr-3">{cat.itemCount}</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-24 text-right shrink-0">{formatCurrency(cat.revenue)}</span>
                    <span className="text-[10px] text-gray-400 w-8 text-right shrink-0 ml-1">{pct}%</span>

                    {/* Actions on hover */}
                    {confirmDeleteId === cat.id ? (
                      <div className="flex items-center gap-1 ml-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { deleteCategoryAction(cat.id, cat.name); setConfirmDeleteId(null); }}
                          className="text-[11px] px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] px-2 py-1 text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { setEditingCategoryId(cat.id); setEditCategoryName(cat.name); }}
                          className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors"
                          title="Rename"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(cat.id)}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Expanded items list */}
                  {isExpanded && (
                    <div className="bg-gray-50/50 dark:bg-gray-900/20 border-t border-gray-100 dark:border-gray-700/50">
                      {cat.items.length > 0 ? (
                        <div className="divide-y divide-gray-100/50 dark:divide-gray-700/30">
                          {cat.items.map((item) => (
                            <div key={item.displayName} className="flex items-center pl-12 pr-4 py-2 hover:bg-gray-100/50 dark:hover:bg-gray-700/20 transition-colors">
                              <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 truncate">{item.displayName}</span>
                              <span className="text-[11px] text-gray-400 w-12 text-right">{item.qty}</span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 w-20 text-right">{formatCurrency(item.revenue)}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); unassignItem(item.displayName); }}
                                className="ml-2 p-0.5 text-gray-300 hover:text-red-500 transition-colors rounded"
                                title="Remove from category"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="pl-12 py-4 text-xs text-gray-400">No items yet. Assign from the right panel.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Unmapped items */}
        {unmapped.length > 0 ? (
          <div className="md:w-1/2 space-y-2">
            <div className="flex items-center gap-3 px-1">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Uncategorized ({filteredUnmapped.length})
              </h3>
              <div className="flex-1" />
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="w-40 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-visible divide-y divide-gray-50 dark:divide-gray-700/30">
              {filteredUnmapped.slice(0, 50).map((item) => (
                <div key={item.displayName} className="px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                  {/* Top row: name + stats */}
                  <div className="flex items-center">
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate min-w-0">{item.displayName}</span>
                    <span className="text-xs text-gray-400 w-12 text-right shrink-0">{item.qty}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right shrink-0">{formatCurrency(item.revenue)}</span>
                  </div>
                  {/* Assign row */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {assigningItem === item.displayName ? (
                      <>
                        {categories.map((c, ci) => (
                          <button
                            key={c.id}
                            onClick={() => assignItem(item.displayName, c.id)}
                            className="text-[11px] px-2.5 py-1 rounded-full border transition-all hover:scale-105"
                            style={{
                              borderColor: getCatColor(c, ci),
                              color: getCatColor(c, ci),
                            }}
                          >
                            {c.name}
                          </button>
                        ))}
                        <button
                          onClick={() => setAssigningItem(null)}
                          className="text-[11px] px-2 py-1 text-gray-400 hover:text-gray-600"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        {item.suggestion && (
                          <button
                            onClick={() => assignItem(item.displayName, item.suggestion!.categoryId)}
                            className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                          >
                            → {item.suggestion.categoryName}
                          </button>
                        )}
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) assignItem(item.displayName, e.target.value); }}
                          className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        >
                          <option value="">Pick...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {filteredUnmapped.length > 50 && (
                <div className="px-4 py-3 text-xs text-gray-400 text-center">
                  Showing 50 of {filteredUnmapped.length}. Use search to narrow down.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="md:w-1/2 flex items-center justify-center">
            <p className="text-sm text-gray-400 dark:text-gray-500">All items are categorized</p>
          </div>
        )}
      </div>
    </div>
  );
}
