"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface ManualTransaction {
  id: string;
  date: string;
  amount: number;
  type: string;
  sourcePlatform: string;
  category: string | null;
  description: string | null;
}

const TYPES = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "fee", label: "Fee" },
  { value: "adjustment", label: "Adjustment" },
];

const PLATFORMS = [
  { value: "manual", label: "Manual" },
  { value: "square", label: "Square" },
  { value: "doordash", label: "DoorDash" },
  { value: "ubereats", label: "Uber Eats" },
  { value: "grubhub", label: "Grubhub" },
  { value: "chase", label: "Chase" },
];

const TYPE_COLORS: Record<string, string> = {
  income: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  expense: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  fee: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  adjustment: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
};

export default function ManualEntryPanel() {
  const [entries, setEntries] = useState<ManualTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: "",
    type: "expense",
    sourcePlatform: "manual",
    category: "",
    description: "",
  });

  const fetchEntries = useCallback(() => {
    setLoading(true);
    fetch("/api/manual-entry?limit=20")
      .then((r) => r.json())
      .then((data) => setEntries(data.transactions || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || !form.date) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/manual-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: "Entry added successfully" });
        setForm({
          date: new Date().toISOString().split("T")[0],
          amount: "",
          type: "expense",
          sourcePlatform: "manual",
          category: "",
          description: "",
        });
        fetchEntries();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to add entry" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/manual-entry?id=${id}`, { method: "DELETE" });
      fetchEntries();
    } catch {
      setMessage({ type: "error", text: "Failed to delete entry" });
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add Manual Transaction</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Add bank transactions that weren&apos;t captured by CSV imports.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Source</label>
            <select
              value={form.sourcePlatform}
              onChange={(e) => setForm({ ...form, sourcePlatform: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g. Groceries, Equipment"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What is this transaction for?"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !form.amount}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? "Adding..." : "Add Entry"}
          </button>
          {message && (
            <span className={`text-sm ${message.type === "success" ? "text-emerald-600" : "text-red-600"}`}>
              {message.text}
            </span>
          )}
        </div>
      </form>

      {/* Recent entries */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Recent Manual Entries ({entries.length})
        </h4>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm py-4 text-center">
            No manual entries yet.
          </p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((tx) => (
                  <tr key={tx.id} className="border-t border-gray-100 dark:border-gray-700/50">
                    <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{tx.date}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">
                      {tx.description || "-"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_COLORS[tx.type] || "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{tx.category || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={tx.type === "income" ? "text-emerald-600" : "text-red-600"}>
                        {formatCurrency(Math.abs(tx.amount))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDelete(tx.id)}
                        className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
