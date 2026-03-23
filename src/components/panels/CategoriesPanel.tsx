"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ExpenseCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  _count: { expenses: number; rules: number; amount: number };
  ignored?: boolean;
}

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

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    await fetch("/api/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCatName, color: newCatColor }),
    });
    setNewCatName("");
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

  return (
    <div className={`space-y-6 max-w-4xl mx-auto transition-opacity ${refreshing ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(["categories", "rules", "review"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "review" && suggestions.length === 0) fetchSuggestions();
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "categories" ? "Categories" : t === "rules" ? "Edit Categorizations" : `Review & Categorize${suggestions.length > 0 ? ` (${suggestions.length})` : ""}`}
          </button>
        ))}
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-700">{message}</p>
        </div>
      )}

      {tab === "categories" && (
        <div className="space-y-4">
          {/* Add Category */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Add Category
            </h3>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Category name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <input
                  type="color"
                  value={newCatColor}
                  onChange={(e) => setNewCatColor(e.target.value)}
                  className="h-9 w-12 rounded border border-gray-300 cursor-pointer"
                />
              </div>
              <button
                onClick={addCategory}
                disabled={!newCatName.trim()}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
              >
                Add
              </button>
            </div>
          </div>

          {/* Category List */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Color</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">
                    Transactions
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">Rules</th>
                  <th className="px-2 py-3 w-14 text-center" />
                  <th className="px-2 py-3 w-14 text-center" />
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr
                    key={cat.id}
                    className={`border-t border-gray-100 cursor-pointer transition-colors ${
                      cat.ignored ? "opacity-50 bg-gray-50/50 hover:bg-gray-100" : "hover:bg-indigo-50"
                    }`}
                    onClick={() =>
                      router.push(
                        `/dashboard/expenses/category/${encodeURIComponent(cat.name)}`
                      )
                    }
                  >
                    <td className="px-4 py-2.5">
                      <label
                        className="relative w-5 h-5 rounded-full block cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 transition-shadow"
                        style={{ backgroundColor: cat.color || "#6b7280" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="color"
                          value={cat.color || "#6b7280"}
                          onChange={(e) =>
                            updateCategoryColor(cat.id, e.target.value)
                          }
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium">
                      <span className="hover:text-indigo-600">{cat.name}</span>
                      {cat.ignored && <span className="ml-2 text-[10px] text-amber-500 font-normal">(ignored)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {cat._count.expenses}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${cat._count.amount < 0 ? "text-emerald-600" : cat._count.amount > 0 ? "text-gray-800" : "text-gray-400"}`}>
                      {cat._count.expenses === 0 ? "—" : `$${Math.abs(cat._count.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      {cat._count.amount < 0 && cat._count.expenses > 0 && <span className="text-[10px] ml-0.5 text-emerald-500">↓</span>}
                      {cat._count.amount > 0 && cat._count.expenses > 0 && <span className="text-[10px] ml-0.5 text-gray-400">↑</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {cat._count.rules}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {cat.ignored ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            unignoreCategory(cat.name);
                          }}
                          className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            ignoreCategory(cat.name);
                          }}
                          className="text-xs text-amber-500 hover:text-amber-700"
                          title="Hide from Bank Activity"
                        >
                          Ignore
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCategory(cat.id, cat.name);
                        }}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Uncategorized row */}
                <tr className="border-t border-gray-200 bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <div className="w-4 h-4 rounded-full border-2 border-dashed border-gray-300" />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-medium italic">
                    Uncategorized
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">
                    {uncategorizedCount}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${uncategorizedAmount < 0 ? "text-emerald-600" : uncategorizedAmount > 0 ? "text-gray-800" : "text-gray-400"}`}>
                    {uncategorizedCount === 0 ? "—" : `$${Math.abs(uncategorizedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    {uncategorizedAmount < 0 && uncategorizedCount > 0 && <span className="text-[10px] ml-0.5 text-emerald-500">↓</span>}
                    {uncategorizedAmount > 0 && uncategorizedCount > 0 && <span className="text-[10px] ml-0.5 text-gray-400">↑</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-400">
                    &mdash;
                  </td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Ignored categories are now shown inline in the table above with muted styling */}
        </div>
      )}

      {tab === "rules" && (
        <div className="space-y-4">
          {/* Auto-categorize buttons */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => runAutoCategories(true)}
              className="border border-amber-300 bg-amber-50 text-amber-700 px-4 py-2 rounded-lg hover:bg-amber-100 text-sm font-medium"
            >
              Re-categorize All
            </button>
            <button
              onClick={() => runAutoCategories(false)}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium"
            >
              Categorize New
            </button>
          </div>

          {/* Add Rule */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Add Rule
            </h3>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Type
                </label>
                <select
                  value={newRuleType}
                  onChange={(e) => setNewRuleType(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="vendor_match">Vendor Match</option>
                  <option value="keyword_match">Keyword Match</option>
                  <option value="description_match">Description Match</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-gray-500 mb-1">
                  Pattern
                </label>
                <input
                  type="text"
                  value={newRulePattern}
                  onChange={(e) => setNewRulePattern(e.target.value)}
                  placeholder={
                    newRuleType === "vendor_match"
                      ? "Exact vendor name"
                      : "Regex pattern"
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Category
                </label>
                <select
                  value={newRuleCategoryId}
                  onChange={(e) => setNewRuleCategoryId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={addRule}
                disabled={!newRulePattern.trim() || !newRuleCategoryId}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
              >
                Add
              </button>
            </div>
          </div>

          {/* Rules grouped by category */}
          {rules.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No rules yet. Add a rule above or categorize expenses to auto-learn.
            </div>
          ) : (
            (() => {
              // Group rules by category name
              const grouped = new Map<string, CategorizationRule[]>();
              for (const rule of rules) {
                const catName = rule.category.name;
                const list = grouped.get(catName);
                if (list) {
                  list.push(rule);
                } else {
                  grouped.set(catName, [rule]);
                }
              }
              // Sort category groups alphabetically
              const sortedGroups = [...grouped.entries()].sort((a, b) =>
                a[0].localeCompare(b[0])
              );

              return (
                <div className="space-y-3">
                  {sortedGroups.map(([catName, catRules]) => {
                    const catColor = categories.find(
                      (c) => c.name === catName
                    )?.color;
                    return (
                      <div
                        key={catName}
                        className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                      >
                        {/* Category header */}
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: catColor || "#6b7280",
                            }}
                          />
                          <h4 className="text-sm font-medium text-gray-700">
                            {catName}
                          </h4>
                          <span className="text-xs text-gray-400 ml-auto">
                            {catRules.length}{" "}
                            {catRules.length === 1 ? "rule" : "rules"}
                          </span>
                        </div>
                        {/* Rules table */}
                        <table className="w-full text-sm">
                          <tbody>
                            {catRules.map((rule) => {
                              const isEditing = editingRuleId === rule.id;
                              return (
                                <tr
                                  key={rule.id}
                                  className="border-t border-gray-100 first:border-t-0 hover:bg-gray-50"
                                >
                                  <td className="px-4 py-2 w-32 whitespace-nowrap">
                                    {isEditing ? (
                                      <select
                                        value={editType}
                                        onChange={(e) => setEditType(e.target.value)}
                                        className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-full"
                                      >
                                        <option value="vendor_match">vendor match</option>
                                        <option value="keyword_match">keyword match</option>
                                        <option value="description_match">description match</option>
                                      </select>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                        {rule.type.replace("_", " ")}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-gray-800 font-mono text-xs">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editPattern}
                                        onChange={(e) => setEditPattern(e.target.value)}
                                        className="w-full border border-gray-300 rounded px-2 py-0.5 text-xs font-mono"
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") saveRule();
                                          if (e.key === "Escape") cancelEditing();
                                        }}
                                        autoFocus
                                      />
                                    ) : (
                                      rule.pattern
                                    )}
                                  </td>
                                  {isEditing ? (
                                    <td className="px-4 py-2">
                                      <select
                                        value={editCategoryId}
                                        onChange={(e) => setEditCategoryId(e.target.value)}
                                        className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                                      >
                                        {categories.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                  ) : (
                                    <td className="px-4 py-2 w-20">
                                      <span
                                        className={`px-2 py-0.5 rounded-full text-xs ${
                                          rule.createdFrom === "auto_learned"
                                            ? "bg-blue-100 text-blue-700"
                                            : "bg-gray-100 text-gray-600"
                                        }`}
                                      >
                                        {rule.createdFrom === "auto_learned"
                                          ? "auto"
                                          : "manual"}
                                      </span>
                                    </td>
                                  )}
                                  {!isEditing && (
                                    <td className="px-4 py-2 text-right text-gray-500 w-16">
                                      {rule.hitCount}
                                    </td>
                                  )}
                                  <td className="px-4 py-2 text-right w-24 whitespace-nowrap">
                                    {isEditing ? (
                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={saveRule}
                                          className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
                                        >
                                          Save
                                        </button>
                                        <button
                                          onClick={cancelEditing}
                                          className="text-xs text-gray-400 hover:text-gray-600"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex gap-2 justify-end">
                                        <button
                                          onClick={() => startEditingRule(rule)}
                                          className="text-xs text-indigo-500 hover:text-indigo-700"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={() => deleteRule(rule.id)}
                                          className="text-xs text-red-500 hover:text-red-700"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      )}

      {tab === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-700">Review & Categorize</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {suggestions.length} vendor{suggestions.length !== 1 ? "s" : ""} without categories. Review suggestions and assign categories.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchSuggestions}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Refresh
              </button>
              {suggestions.filter((s) => s.selectedCategoryId).length > 0 && (
                <button
                  onClick={applyAllSuggestions}
                  className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Apply All ({suggestions.filter((s) => s.selectedCategoryId).length})
                </button>
              )}
            </div>
          </div>

          {suggestionsLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
              <p className="text-emerald-700 font-medium">All vendors categorized!</p>
              <p className="text-xs text-emerald-600 mt-1">No uncategorized vendors found.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500 text-xs">
                    <th className="px-4 py-2.5">Vendor</th>
                    <th className="px-4 py-2.5 text-right">Txns</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5">RM Category</th>
                    <th className="px-4 py-2.5">Assign Category</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => (
                    <tr key={s.vendorName} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{s.vendorName}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{s.count}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        ${s.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                          {s.rmCategory || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
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
                          className={`w-full border rounded px-2 py-1 text-xs ${
                            s.selectedCategoryId ? "border-indigo-300 bg-indigo-50" : "border-gray-300"
                          }`}
                        >
                          <option value="">Select category...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex gap-1 justify-end">
                          {s.selectedCategoryId && (
                            <button
                              onClick={() => applySuggestion(s.vendorName, s.selectedCategoryId!)}
                              className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                            >
                              Apply
                            </button>
                          )}
                          <button
                            onClick={() => skipSuggestion(s.vendorName)}
                            className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                          >
                            Skip
                          </button>
                          <button
                            onClick={() => ignoreSuggestion(s.vendorName)}
                            className="px-2 py-0.5 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
                          >
                            Ignore
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
