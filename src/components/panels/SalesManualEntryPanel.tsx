"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface ManualOrder {
  id: string;
  date: string;
  platform: string;
  grossSales: number;
  tax: number;
  tip: number;
  fees: number;
  netSales: number;
  items: string;
}

const PLATFORMS = [
  { value: "manual", label: "Manual" },
  { value: "square", label: "Square" },
  { value: "doordash", label: "DoorDash" },
  { value: "ubereats", label: "Uber Eats" },
  { value: "grubhub", label: "Grubhub" },
];

export default function SalesManualEntryPanel() {
  const [entries, setEntries] = useState<ManualOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    platform: "manual",
    grossSales: "",
    tax: "",
    tip: "",
    fees: "",
    items: "",
    diningOption: "",
  });
  const [taxMode, setTaxMode] = useState<"%" | "$">("$");

  const fetchEntries = useCallback(() => {
    setLoading(true);
    fetch("/api/manual-order?limit=20")
      .then((r) => r.json())
      .then((data) => setEntries(data.orders || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.grossSales || !form.date) return;

    setSaving(true);
    setMessage(null);

    try {
      // Compute tax value from percentage if needed
      const taxValue = taxMode === "%" && form.tax && form.grossSales
        ? String(Math.round(parseFloat(form.grossSales) * parseFloat(form.tax) / 100 * 100) / 100)
        : form.tax;

      const response = await fetch("/api/manual-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tax: taxValue }),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: "Order added successfully" });
        setForm({
          date: new Date().toISOString().split("T")[0],
          platform: "manual",
          grossSales: "",
          tax: "",
          tip: "",
          fees: "",
          items: "",
          diningOption: "",
        });
        fetchEntries();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to add order" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/manual-order?id=${id}`, { method: "DELETE" });
      fetchEntries();
    } catch {
      setMessage({ type: "error", text: "Failed to delete order" });
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add Manual Order</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Add orders that weren&apos;t captured by platform imports or API sync.
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
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Platform</label>
            <select
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Gross Sales</label>
            <input
              type="number"
              step="0.01"
              value={form.grossSales}
              onChange={(e) => setForm({ ...form, grossSales: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fees</label>
            <input
              type="number"
              step="0.01"
              value={form.fees}
              onChange={(e) => setForm({ ...form, fees: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Tax</label>
              <button
                type="button"
                onClick={() => { setTaxMode(taxMode === "$" ? "%" : "$"); setForm({ ...form, tax: "" }); }}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {taxMode === "$" ? "Switch to %" : "Switch to $"}
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{taxMode === "$" ? "$" : "%"}</span>
              <input
                type="number"
                step={taxMode === "%" ? "0.1" : "0.01"}
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
                placeholder={taxMode === "%" ? "8.875" : "0.00"}
                className="w-full pl-7 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {taxMode === "%" && form.tax && form.grossSales && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                = ${(parseFloat(form.grossSales) * parseFloat(form.tax) / 100).toFixed(2)}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tip</label>
            <input
              type="number"
              step="0.01"
              value={form.tip}
              onChange={(e) => setForm({ ...form, tip: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Items / Description</label>
            <input
              type="text"
              value={form.items}
              onChange={(e) => setForm({ ...form, items: e.target.value })}
              placeholder="e.g. 2x Fruitella Crêpe | 1x Coffee"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !form.grossSales}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? "Adding..." : "Add Order"}
          </button>
          {message && (
            <span className={`text-sm ${message.type === "success" ? "text-emerald-600" : "text-red-600"}`}>
              {message.text}
            </span>
          )}
        </div>
      </form>

      {/* Recent manual orders */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Recent Manual Orders ({entries.length})
        </h4>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm py-4 text-center">
            No manual orders yet.
          </p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Platform</th>
                  <th className="px-3 py-2 font-medium">Items</th>
                  <th className="px-3 py-2 font-medium text-right">Gross</th>
                  <th className="px-3 py-2 font-medium text-right">Net</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((o) => (
                  <tr key={o.id} className="border-t border-gray-100 dark:border-gray-700/50">
                    <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{o.date}</td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {o.platform}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">{o.items}</td>
                    <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">{formatCurrency(o.grossSales)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600">{formatCurrency(o.netSales)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleDelete(o.id)}
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
