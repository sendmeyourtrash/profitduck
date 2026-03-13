"use client";

import { useState, useEffect, useCallback } from "react";

interface ExpenseCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  _count: { expenses: number; rules: number };
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

export default function CategoriesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [tab, setTab] = useState<"categories" | "rules">("categories");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // New category form
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#6366f1");

  // New rule form
  const [newRuleType, setNewRuleType] = useState("vendor_match");
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleCategoryId, setNewRuleCategoryId] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [catRes, ruleRes] = await Promise.all([
      fetch("/api/expense-categories").then((r) => r.json()),
      fetch("/api/categorization-rules").then((r) => r.json()),
    ]);
    setCategories(catRes.categories || []);
    setRules(ruleRes.rules || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
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

  const runAutoCategories = async () => {
    setMessage("Running auto-categorization...");
    const res = await fetch("/api/categorization-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    const data = await res.json();
    setMessage(`Auto-categorized ${data.categorized} expense(s)`);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(["categories", "rules"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "categories" ? "Categories" : "Auto-Categorization Rules"}
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
                    Expenses
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Rules</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr
                    key={cat.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: cat.color || "#6b7280" }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium">
                      {cat.name}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {cat._count.expenses}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {cat._count.rules}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div className="space-y-4">
          {/* Auto-categorize button */}
          <div className="flex justify-end">
            <button
              onClick={runAutoCategories}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium"
            >
              Run Auto-Categorization
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
                  <option value="category_match">Category Match</option>
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

          {/* Rules List */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Pattern</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium text-right">Hits</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                        {rule.type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 font-mono text-xs">
                      {rule.pattern}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {rule.category.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          rule.createdFrom === "auto_learned"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {rule.createdFrom === "auto_learned"
                          ? "learned"
                          : "manual"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {rule.hitCount}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-gray-400 text-sm"
                    >
                      No rules yet. Add a rule above or categorize expenses to
                      auto-learn.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
