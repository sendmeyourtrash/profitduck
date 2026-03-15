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

export default function ManualEntryPanel() {
  const [entries, setEntries] = useState<ManualTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: "",
    type: "income",
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
          type: "income",
          sourcePlatform: "manual",
          category: "",
          description: "",
        });
        fetchEntries();
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/manual-entry?id=${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        fetchEntries();
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Entry Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Add Manual Entry
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Date *
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Amount *
              </label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Type *
              </label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Platform
              </label>
              <select
                value={form.sourcePlatform}
                onChange={(e) =>
                  setForm({ ...form, sourcePlatform: e.target.value })
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Category
              </label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g., Food Cost, Equipment"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Description
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="What is this entry for?"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !form.amount}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {saving ? "Saving..." : "Add Entry"}
            </button>
            {message && (
              <p
                className={`text-sm ${
                  message.type === "success"
                    ? "text-emerald-600"
                    : "text-red-600"
                }`}
              >
                {message.text}
              </p>
            )}
          </div>
        </form>
      </div>

      {/* Recent Manual Entries */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-500">
            Recent Manual Entries
          </h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            No manual entries yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Platform</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">
                      {tx.description || "-"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                        {tx.sourcePlatform}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          tx.type === "income"
                            ? "bg-emerald-100 text-emerald-700"
                            : tx.type === "expense"
                              ? "bg-red-100 text-red-700"
                              : tx.type === "adjustment"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-medium ${
                        tx.type === "income"
                          ? "text-emerald-600"
                          : "text-gray-800"
                      }`}
                    >
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleDelete(tx.id)}
                        className="text-xs text-red-500 hover:text-red-700"
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
