"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface VendorAlias {
  id: string;
  pattern: string;
  matchType: string;
  displayName: string;
  autoCreated: boolean;
}

interface UnmatchedVendor {
  id: string;
  name: string;
  expenseCount: number;
  totalSpent: number;
}

export default function VendorAliasesPanel() {
  const [aliases, setAliases] = useState<VendorAlias[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedVendor[]>([]);
  const [ignored, setIgnored] = useState<UnmatchedVendor[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // New alias form
  const [newPattern, setNewPattern] = useState("");
  const [newMatchType, setNewMatchType] = useState("starts_with");
  const [newDisplayName, setNewDisplayName] = useState("");

  // Inline editing
  const [editId, setEditId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editMatchType, setEditMatchType] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  // Quick-add from unmatched
  const [quickAddVendor, setQuickAddVendor] = useState<string | null>(null);
  const [quickDisplayName, setQuickDisplayName] = useState("");

  // Section toggles
  const [showAliases, setShowAliases] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/vendor-aliases");
    const data = await res.json();
    setAliases(data.aliases || []);
    setUnmatched(data.unmatched || []);
    setIgnored(data.ignored || []);
    setMatchedCount(data.matchedCount || 0);
    setUnmatchedCount(data.unmatchedCount || 0);
    setIgnoredCount(data.ignoredCount || 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addAlias = async () => {
    if (!newPattern.trim() || !newDisplayName.trim()) return;
    setMessage("Creating alias...");
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: newPattern,
        matchType: newMatchType,
        displayName: newDisplayName,
      }),
    });
    setNewPattern("");
    setNewDisplayName("");
    setMessage("Alias created and applied.");
    fetchData();
  };

  const quickAdd = async (vendorName: string) => {
    if (!quickDisplayName.trim()) return;
    setMessage("Creating alias...");
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: vendorName,
        matchType: "exact",
        displayName: quickDisplayName,
      }),
    });
    setQuickAddVendor(null);
    setQuickDisplayName("");
    setMessage("Alias created and applied.");
    fetchData();
  };

  const deleteAlias = async (id: string) => {
    await fetch(`/api/vendor-aliases?id=${id}`, { method: "DELETE" });
    setMessage("Alias deleted.");
    fetchData();
  };

  const ignoreVendor = async (vendorName: string) => {
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", vendorName }),
    });
    setMessage(`"${vendorName}" ignored.`);
    fetchData();
  };

  const unignoreVendor = async (vendorName: string) => {
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unignore", vendorName }),
    });
    setMessage(`"${vendorName}" restored.`);
    fetchData();
  };

  const startEdit = (alias: VendorAlias) => {
    setEditId(alias.id);
    setEditPattern(alias.pattern);
    setEditMatchType(alias.matchType);
    setEditDisplayName(alias.displayName);
  };

  const cancelEdit = () => setEditId(null);

  const saveEdit = async () => {
    if (!editId || !editPattern.trim() || !editDisplayName.trim()) return;
    setMessage("Updating alias...");
    await fetch("/api/vendor-aliases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editId,
        pattern: editPattern,
        matchType: editMatchType,
        displayName: editDisplayName,
      }),
    });
    setEditId(null);
    setMessage("Alias updated and re-applied.");
    fetchData();
  };

  const applyAll = async () => {
    setMessage("Applying aliases to all vendors...");
    const res = await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    const data = await res.json();
    setMessage(`Updated ${data.updated} of ${data.total} vendors.`);
    fetchData();
  };

  // Group aliases by displayName for cleaner display
  const aliasGroups = aliases.reduce<Record<string, VendorAlias[]>>((acc, a) => {
    (acc[a.displayName] = acc[a.displayName] || []).push(a);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Vendor Aliases</h2>
          <p className="text-sm text-gray-500">
            Map messy bank transaction names to clean vendor names for reporting.
          </p>
        </div>
        <button
          onClick={applyAll}
          className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Re-apply All Aliases
        </button>
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-700">{message}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Alias Rules</p>
          <p className="text-2xl font-bold text-gray-800">{aliases.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Vendors Matched</p>
          <p className="text-2xl font-bold text-emerald-600">{matchedCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Unmatched</p>
          <p className="text-2xl font-bold text-amber-600">{unmatchedCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Ignored</p>
          <p className="text-2xl font-bold text-gray-400">{ignoredCount}</p>
        </div>
      </div>

      {/* Add New Alias */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Add Alias Rule</h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Pattern</label>
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="e.g. ORIG CO NAME:CON ED"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Match Type</label>
            <select
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="starts_with">Starts With</option>
              <option value="contains">Contains</option>
              <option value="exact">Exact Match</option>
            </select>
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs text-gray-500 mb-1">Display Name</label>
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="e.g. Con Edison"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={addAlias}
            disabled={!newPattern.trim() || !newDisplayName.trim()}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
          >
            Add
          </button>
        </div>
      </div>

      {/* Active Aliases — grouped by displayName, collapsible */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowAliases(!showAliases)}
          className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
        >
          <h3 className="text-sm font-medium text-gray-700">
            Active Aliases ({Object.keys(aliasGroups).length} groups, {aliases.length} rules)
          </h3>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showAliases ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showAliases && <div className="divide-y divide-gray-100">
          {Object.entries(aliasGroups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([displayName, group]) => (
              <div key={displayName} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-800 text-sm">{displayName}</span>
                  <span className="text-xs text-gray-400">
                    {group.length} rule{group.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-1">
                  {group.map((alias) =>
                    editId === alias.id ? (
                      <div key={alias.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg p-2">
                        <input
                          type="text"
                          value={editPattern}
                          onChange={(e) => setEditPattern(e.target.value)}
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                        />
                        <select
                          value={editMatchType}
                          onChange={(e) => setEditMatchType(e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1 text-xs"
                        >
                          <option value="starts_with">Starts With</option>
                          <option value="contains">Contains</option>
                          <option value="exact">Exact Match</option>
                        </select>
                        <input
                          type="text"
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          placeholder="Display Name"
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                        <button
                          onClick={saveEdit}
                          disabled={!editPattern.trim() || !editDisplayName.trim()}
                          className="px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div
                        key={alias.id}
                        className="flex items-center justify-between text-xs text-gray-500"
                      >
                        <span>
                          <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 mr-1.5">
                            {alias.matchType.replace("_", " ")}
                          </span>
                          <span className="font-mono text-gray-600">
                            {alias.pattern.length > 60
                              ? alias.pattern.slice(0, 60) + "..."
                              : alias.pattern}
                          </span>
                          {alias.autoCreated && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                              auto
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => startEdit(alias)}
                            className="text-indigo-400 hover:text-indigo-600"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteAlias(alias.id)}
                            className="text-red-400 hover:text-red-600"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
        </div>}
      </div>

      {/* Unmatched Vendors */}
      {unmatched.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
            <h3 className="text-sm font-medium text-amber-800">
              Unmatched Vendors ({unmatchedCount})
            </h3>
            <p className="text-xs text-amber-600 mt-0.5">
              These vendor names have no alias. Add an alias to unify, or ignore to hide from this list.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-2 font-medium">Vendor Name</th>
                <th className="px-4 py-2 font-medium text-right">Expenses</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((v) => (
                <tr key={v.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-800 max-w-[300px]">
                    <span className="block truncate" title={v.name}>
                      {v.name}
                    </span>
                    {quickAddVendor === v.name && (
                      <div className="mt-2 flex gap-2 items-center">
                        <input
                          type="text"
                          value={quickDisplayName}
                          onChange={(e) => setQuickDisplayName(e.target.value)}
                          placeholder="Display name..."
                          className="border border-gray-300 rounded px-2 py-1 text-xs flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") quickAdd(v.name);
                            if (e.key === "Escape") setQuickAddVendor(null);
                          }}
                        />
                        <button
                          onClick={() => quickAdd(v.name)}
                          disabled={!quickDisplayName.trim()}
                          className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setQuickAddVendor(null)}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">{v.expenseCount}</td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    {formatCurrency(v.totalSpent)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {quickAddVendor !== v.name && (
                      <span className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setQuickAddVendor(v.name);
                            setQuickDisplayName("");
                          }}
                          className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                        >
                          Add Alias
                        </button>
                        <button
                          onClick={() => ignoreVendor(v.name)}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-500 rounded hover:bg-gray-200"
                        >
                          Ignore
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ignored Vendors — collapsible */}
      {ignoredCount > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
          >
            <h3 className="text-sm font-medium text-gray-500">
              Ignored Vendors ({ignoredCount})
            </h3>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${showIgnored ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showIgnored && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-2 font-medium">Vendor Name</th>
                  <th className="px-4 py-2 font-medium text-right">Expenses</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {ignored.map((v) => (
                  <tr key={v.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-400 max-w-[300px]">
                      <span className="block truncate" title={v.name}>
                        {v.name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400">{v.expenseCount}</td>
                    <td className="px-4 py-2 text-right text-gray-400">
                      {formatCurrency(v.totalSpent)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => unignoreVendor(v.name)}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      >
                        Unignore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
