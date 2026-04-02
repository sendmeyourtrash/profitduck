"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils/format";

interface ExpenseCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  _count: { expenses: number; rules: number; amount: number };
  topVendors?: { name: string; count: number; amount: number }[];
  ignored?: boolean;
}

// 12 visually distinct colors for auto-assignment
const COLOR_PALETTE = [
  "#8b5cf6", "#22c55e", "#3b82f6", "#06b6d4", "#ec4899", "#f59e0b",
  "#6366f1", "#f97316", "#f43f5e", "#14b8a6", "#10b981", "#a855f7",
];

interface CategorizationRule {
  id: string;
  type: string;
  pattern: string;
  priority: number;
  createdFrom: string;
  hitCount: number;
  category: { id: string; name: string };
}

interface Suggestion {
  vendorName: string;
  count: number;
  totalAmount: number;
  rmCategory: string;
  suggestedCategory: { id: string; name: string; color: string | null } | null;
  selectedCategoryId?: string; // user's choice (local state)
}

export default function CategoriesPanel() {
  const router = useRouter();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [uncategorizedAmount, setUncategorizedAmount] = useState(0);
  const [ignoredCategories, setIgnoredCategories] = useState<{ id: number; categoryName: string; count: number }[]>([]);
  const [tab, setTab] = useState<"categories" | "rules" | "review">("categories");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Dashboard view state
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [setupMode, setSetupMode] = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");

  // New category form
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#6366f1");

  // New rule form
  const [newRuleType, setNewRuleType] = useState("vendor_match");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleCategoryId, setNewRuleCategoryId] = useState("");

  // Inline editing
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editType, setEditType] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setInitialLoading(true);
    else setRefreshing(true);
    const [catRes, ruleRes] = await Promise.all([
      fetch("/api/expense-categories").then((r) => r.json()),
      fetch("/api/categorization-rules").then((r) => r.json()),
    ]);
    // Merge ignored categories into the main list with a flag
    const activeCats = (catRes.categories || []).map((c: ExpenseCategory) => ({ ...c, ignored: false }));
    const ignoredCats = (catRes.ignoredCategories || []).map((ic: { categoryName: string; count: number }) => {
      // Find the full category data if it exists in active list (it won't since it's ignored)
      const existing = activeCats.find((c: ExpenseCategory) => c.name.toLowerCase() === ic.categoryName.toLowerCase());
      if (existing) {
        existing.ignored = true;
        return null;
      }
      // Category exists in expense_categories but is ignored — find its data from the API
      const fullCat = (catRes.categories || []).find((c: ExpenseCategory) => c.name.toLowerCase() === ic.categoryName.toLowerCase());
      return fullCat ? { ...fullCat, ignored: true } : null;
    }).filter(Boolean);

    // Mark any categories that are in the ignored list
    const ignoredNames = new Set((catRes.ignoredCategories || []).map((ic: { categoryName: string }) => ic.categoryName.toLowerCase()));
    const allCats = activeCats.map((c: ExpenseCategory) => ({
      ...c,
      ignored: ignoredNames.has(c.name.toLowerCase()),
    }));

    setCategories(allCats);
    setRules(ruleRes.rules || []);
    setUncategorizedCount(catRes.uncategorizedCount || 0);
    setUncategorizedAmount(catRes.uncategorizedAmount || 0);
    setIgnoredCategories(catRes.ignoredCategories || []);
    setInitialLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  // Fetch suggestions on mount whenever there are uncategorized items
  useEffect(() => {
    if (!initialLoading && uncategorizedCount > 0 && suggestions.length === 0) {
      fetchSuggestions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading, uncategorizedCount]);

  // Pick the next color that isn't already used by an existing category
  const nextColor = () => {
    const usedColors = new Set(categories.map((c) => c.color));
    return COLOR_PALETTE.find((c) => !usedColors.has(c)) || COLOR_PALETTE[categories.length % COLOR_PALETTE.length];
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const color = newCatColor === "#6366f1" ? nextColor() : newCatColor; // Use auto-color unless user explicitly picked one
    await fetch("/api/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCatName, color }),
    });
    setNewCatName("");
    setNewCatColor("#6366f1"); // Reset for next add
    fetchData();
  };

  const addRule = async () => {
    if (!newRulePattern.trim() || !newRuleCategoryId) return;
    await fetch("/api/categorization-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: newRuleType,
        pattern: newRulePattern,
        categoryId: newRuleCategoryId,
        priority: 5,
      }),
    });
    setNewRulePattern("");
    fetchData();
  };

  const deleteRule = async (id: string) => {
    await fetch(`/api/categorization-rules?id=${id}`, { method: "DELETE" });
    fetchData();
  };

  const startEditingRule = (rule: CategorizationRule) => {
    setEditingRuleId(rule.id);
    setEditType(rule.type);
    setEditPattern(rule.pattern);
    setEditCategoryId(rule.category.id);
  };

  const cancelEditing = () => {
    setEditingRuleId(null);
  };

  const saveRule = async () => {
    if (!editingRuleId || !editPattern.trim() || !editCategoryId) return;
    await fetch("/api/categorization-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingRuleId,
        type: editType,
        pattern: editPattern,
        categoryId: editCategoryId,
      }),
    });
    setEditingRuleId(null);
    fetchData();
  };

  const updateCategoryColor = async (id: string, color: string) => {
    await fetch("/api/expense-categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, color }),
    });
    // Update locally for instant feedback
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, color } : c))
    );
  };

  const deleteCategory = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Its expenses will become uncategorized and its rules will be removed.`)) return;
    await fetch(`/api/expense-categories?id=${id}`, { method: "DELETE" });
    fetchData();
  };

  const ignoreCategory = async (categoryName: string) => {
    await fetch("/api/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore-category", categoryName }),
    });
    setMessage(`"${categoryName}" ignored from bank statements`);
    fetchData();
  };

  const unignoreCategory = async (categoryName: string) => {
    await fetch("/api/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unignore-category", categoryName }),
    });
    setMessage(`"${categoryName}" restored to bank statements`);
    fetchData();
  };

  const runAutoCategories = async (rerunAll = false) => {
    setMessage(
      rerunAll
        ? "Re-categorizing all expenses..."
        : "Running auto-categorization..."
    );
    const res = await fetch("/api/categorization-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run", rerunAll }),
    });
    const data = await res.json();
    setMessage(
      rerunAll
        ? `Re-categorized ${data.categorized} expense(s)`
        : `Auto-categorized ${data.categorized} expense(s)`
    );
    fetchData();
  };

  const fetchSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const res = await fetch("/api/categorization-rules?action=suggest");
      const data = await res.json();
      setSuggestions(
        data.suggestions.map((s: Suggestion) => ({
          ...s,
          selectedCategoryId: s.suggestedCategory?.id || "",
        }))
      );
    } catch (e) {
      console.error(e);
    }
    setSuggestionsLoading(false);
  };

  const applySuggestion = async (vendorName: string, categoryId: string) => {
    await fetch("/api/categorization-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "learn", vendorName, categoryId }),
    });
    setSuggestions((prev) => prev.filter((s) => s.vendorName !== vendorName));
    setMessage(`"${vendorName}" categorized.`);
    fetchData();
  };

  const ignoreSuggestion = async (vendorName: string) => {
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", vendorName }),
    });
    setSuggestions((prev) => prev.filter((s) => s.vendorName !== vendorName));
    setMessage(`"${vendorName}" ignored.`);
  };

  const skipSuggestion = (vendorName: string) => {
    setSuggestions((prev) => prev.filter((s) => s.vendorName !== vendorName));
  };

  const applyAllSuggestions = async () => {
    const toApply = suggestions.filter((s) => s.selectedCategoryId);
    setMessage(`Applying ${toApply.length} categorizations...`);
    for (const s of toApply) {
      await fetch("/api/categorization-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "learn", vendorName: s.vendorName, categoryId: s.selectedCategoryId }),
      });
    }
    setSuggestions((prev) => prev.filter((s) => !s.selectedCategoryId));
    setMessage(`Applied ${toApply.length} categorizations.`);
    fetchData();
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const activeCategories = categories.filter((c) => !c.ignored);
  const ignoredCategoriesList = categories.filter((c) => c.ignored);
  const totalCategorized = activeCategories.reduce((sum, c) => sum + c._count.expenses, 0);
  const totalTransactions = totalCategorized + uncategorizedCount;
  const categorizedPct = totalTransactions > 0 ? Math.round((totalCategorized / totalTransactions) * 100) : 0;

  const filteredSuggestions = suggestions.filter((s) =>
    vendorSearch.trim() === "" ||
    s.vendorName.toLowerCase().includes(vendorSearch.toLowerCase())
  );

  const applyAllCount = suggestions.filter((s) => s.selectedCategoryId).length;

  // Setup flow: no categories yet
  if (setupMode || categories.length === 0) {
    const DEFAULT_CATEGORIES: { name: string; color: string }[] = [
      { name: "Rent & Utilities", color: "#8b5cf6" },
      { name: "Groceries & Ingredients", color: "#22c55e" },
      { name: "Payroll & Salary", color: "#3b82f6" },
      { name: "Insurance", color: "#06b6d4" },
      { name: "Marketing & Advertising", color: "#ec4899" },
      { name: "Office Supplies", color: "#f59e0b" },
      { name: "Software & Tech", color: "#6366f1" },
      { name: "Shopping", color: "#f97316" },
      { name: "Dining", color: "#f43f5e" },
      { name: "Bills & Utilities", color: "#14b8a6" },
    ];
    return (
      <div className="flex items-center justify-center min-h-[480px]">
        {/* Toast */}
        {message && (
          <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium bg-gray-800 text-white">
            {message}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 shadow-sm p-8 max-w-lg w-full text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">Set Up Expense Categories</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Categories let you track where your money goes. Start with suggested defaults pulled from your bank data, or build your own list from scratch.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={async () => {
                await fetchSuggestions();
                setSetupMode(true);
              }}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Suggest from Bank Data
            </button>
            <button
              onClick={() => {
                setShowAddCategory(true);
                setSetupMode(false);
              }}
              className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors"
            >
              Start from Scratch
            </button>
          </div>

          {/* Suggestion checkboxes shown after fetching */}
          {suggestionsLoading && (
            <div className="mt-6 flex justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          )}

          {!suggestionsLoading && setupMode && (
            <div className="mt-6 text-left">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
                Recommended categories based on your transactions:
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {DEFAULT_CATEGORIES.map((cat) => (
                  <label key={cat.name} className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 accent-indigo-600"
                      id={`setup-cat-${cat.name}`}
                    />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm text-gray-700 dark:text-gray-200 group-hover:text-indigo-600 transition-colors">{cat.name}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={async () => {
                  const checked = DEFAULT_CATEGORIES.filter((cat) => {
                    const el = document.getElementById(`setup-cat-${cat.name}`) as HTMLInputElement | null;
                    return el?.checked ?? true;
                  });
                  for (const cat of checked) {
                    await fetch("/api/expense-categories", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: cat.name, color: cat.color }),
                    });
                  }
                  setSetupMode(false);
                  fetchData();
                  setMessage(`Created ${checked.length} categories.`);
                }}
                className="mt-4 w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                Create Selected Categories
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-5 transition-opacity ${refreshing ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Toast */}
      {message && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium bg-gray-800 text-white">
          {message}
        </div>
      )}

      {/* Top bar: progress + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 tabular-nums">
              {totalCategorized.toLocaleString()} / {totalTransactions.toLocaleString()}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">transactions categorized</span>
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 ml-auto">{categorizedPct}%</span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${categorizedPct}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => runAutoCategories(false)}
            className="px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Auto-Categorize
          </button>
          <button
            onClick={() => setShowAddCategory((v) => !v)}
            className="px-3.5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors"
          >
            + Add Category
          </button>
        </div>
      </div>

      {/* Inline add-category form */}
      {showAddCategory && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">New Category</h3>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newCatName.trim()) {
                    addCategory();
                    setShowAddCategory(false);
                  }
                  if (e.key === "Escape") setShowAddCategory(false);
                }}
                placeholder="Category name"
                autoFocus
                className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                className="h-9 w-12 rounded-lg border border-gray-200 dark:border-gray-600 cursor-pointer"
              />
            </div>
            <button
              onClick={() => { addCategory(); setShowAddCategory(false); }}
              disabled={!newCatName.trim()}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl disabled:opacity-50 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setShowAddCategory(false)}
              className="px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ---- LEFT: Categories ---- */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Categories ({activeCategories.length})
          </h2>

          {activeCategories.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
              No active categories. Click "+ Add Category" to create one.
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeCategories.map((cat) => {
                const isExpanded = expandedCategoryId === cat.id;
                const catRules = rules.filter((r) => r.category.id === cat.id);
                return (
                  <div
                    key={cat.id}
                    className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden"
                  >
                    {/* Category row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors group"
                      onClick={() => setExpandedCategoryId(isExpanded ? null : cat.id)}
                    >
                      {/* Color dot (click to change color) */}
                      <label
                        className="relative w-4 h-4 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 transition-shadow"
                        style={{ backgroundColor: cat.color || "#6b7280" }}
                        onClick={(e) => e.stopPropagation()}
                        title="Change color"
                      >
                        <input
                          type="color"
                          value={cat.color || "#6b7280"}
                          onChange={(e) => updateCategoryColor(cat.id, e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </label>

                      {/* Name */}
                      <span
                        className="flex-1 min-w-0 text-sm font-medium text-gray-800 dark:text-gray-100 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/dashboard/expenses/category/${encodeURIComponent(cat.name)}`);
                        }}
                      >
                        {cat.name}
                      </span>

                      {/* Stats */}
                      <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                        {cat._count.expenses} txns
                      </span>
                      <span className={`text-sm font-medium tabular-nums ${
                        cat._count.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-700 dark:text-gray-300"
                      }`}>
                        {cat._count.expenses === 0 ? "—" : formatCurrency(Math.abs(cat._count.amount))}
                      </span>

                      {/* Hover actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => ignoreCategory(cat.name)}
                          className="text-xs text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 px-1.5 py-0.5 rounded transition-colors"
                          title="Hide from bank activity"
                        >
                          Ignore
                        </button>
                        <button
                          onClick={() => deleteCategory(cat.id, cat.name)}
                          className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-400 px-1.5 py-0.5 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>

                      {/* Chevron */}
                      <svg
                        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {/* Expanded: top vendors with amounts */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/20 px-4 py-3">
                        {(!cat.topVendors || cat.topVendors.length === 0) ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500">No transactions in this category yet.</p>
                        ) : (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Top vendors</p>
                            {cat.topVendors.map((vendor, vi) => {
                              const catTotal = Math.abs(cat._count.amount) || 1;
                              const pct = Math.round((Math.abs(vendor.amount) / catTotal) * 100);
                              return (
                              <div key={`${vendor.name}-${vi}`} className="flex items-center gap-2">
                                <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0">{vendor.name}</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums shrink-0">{vendor.count} txns</span>
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 tabular-nums shrink-0">{formatCurrency(Math.abs(vendor.amount))}</span>
                                <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden shrink-0">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cat.color || "#6b7280" }} />
                                </div>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums w-8 text-right shrink-0">{pct}%</span>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Ignored categories at bottom */}
          {ignoredCategoriesList.length > 0 && (
            <div className="space-y-1.5 mt-4">
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Ignored</h3>
              {ignoredCategoriesList.map((cat) => (
                <div
                  key={cat.id}
                  className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 px-4 py-2.5 flex items-center gap-3 opacity-50"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color || "#6b7280" }}
                  />
                  <span className="flex-1 text-sm text-gray-600 dark:text-gray-400 italic">{cat.name}</span>
                  <button
                    onClick={() => unignoreCategory(cat.name)}
                    className="text-xs font-medium text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-400 transition-colors"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- RIGHT: Uncategorized Vendors ---- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Needs Review ({suggestions.length} vendor{suggestions.length !== 1 ? "s" : ""})
            </h2>
            {applyAllCount > 1 && (
              <button
                onClick={applyAllSuggestions}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors"
              >
                Apply All ({applyAllCount})
              </button>
            )}
          </div>

          {/* Search */}
          {suggestions.length > 0 && (
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                placeholder="Search vendors..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {suggestionsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-8 text-center">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">All vendors categorized</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No uncategorized vendors found.</p>
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
              No vendors match &ldquo;{vendorSearch}&rdquo;
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredSuggestions.map((s, si) => (
                <div
                  key={`${s.vendorName}-${si}`}
                  className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 px-4 py-3"
                >
                  {/* Top row: name + counts */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight truncate">{s.vendorName}</span>
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                      <span>{s.count} txns</span>
                      <span className="font-medium text-gray-600 dark:text-gray-300">{formatCurrency(s.totalAmount)}</span>
                    </div>
                  </div>
                  {/* Bottom row: RM badge + category picker + actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.rmCategory && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {s.rmCategory}
                      </span>
                    )}
                    <select
                      value={s.selectedCategoryId || ""}
                      onChange={(e) => {
                        setSuggestions((prev) =>
                          prev.map((p) =>
                            p.vendorName === s.vendorName
                              ? { ...p, selectedCategoryId: e.target.value }
                              : p
                          )
                        );
                      }}
                      className={`flex-1 min-w-[140px] border rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                        s.selectedCategoryId
                          ? "border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20"
                          : "border-gray-200 dark:border-gray-600"
                      }`}
                    >
                      <option value="">Select category...</option>
                      {categories.filter((c) => !c.ignored).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {s.selectedCategoryId && (
                      <button
                        onClick={() => applySuggestion(s.vendorName, s.selectedCategoryId!)}
                        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                        title="Accept"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => skipSuggestion(s.vendorName)}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title="Skip"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
