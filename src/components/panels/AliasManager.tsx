"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";

// ---------- Types ----------

interface Alias {
  id: string;
  pattern: string;
  matchType: string;
  displayName: string;
}

interface UnmatchedItem {
  name: string;
  qty: number;
  revenue: number;
}

interface AliasWarning {
  type: "conflict";
  severity: "error";
  aliasId: string;
  aliasPattern: string;
  aliasMatchType: string;
  aliasDisplayName: string;
  message: string;
  affectedItems: string[];
}

interface AliasManagerConfig {
  /** API endpoint for CRUD operations */
  apiEndpoint: string;
  /** Label for the entity type: "Item" | "Category" */
  entityLabel: string;
  /** Placeholder for the pattern field */
  patternPlaceholder: string;
  /** Placeholder for the display name field */
  displayPlaceholder: string;
  /** Field name for ignore action body key: "itemName" | "categoryName" */
  ignoreFieldName: string;
}

// ---------- Component ----------

export default function AliasManager({ config }: { config: AliasManagerConfig }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [ignored, setIgnored] = useState<UnmatchedItem[]>([]);
  const [stats, setStats] = useState({ rules: 0, matched: 0, unmatched: 0, ignored: 0 });
  const [warnings, setWarnings] = useState<AliasWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "info" } | null>(null);

  // Search
  const [search, setSearch] = useState("");

  // Add rule modal
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newMatchType, setNewMatchType] = useState("exact");
  const [newDisplayName, setNewDisplayName] = useState("");

  // Inline editing
  const [editId, setEditId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editMatchType, setEditMatchType] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  // Quick rename from unmatched
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Pagination
  const PAGE_SIZE = 25;
  const [unmatchedVisible, setUnmatchedVisible] = useState(PAGE_SIZE);

  // Section state
  const [showIgnored, setShowIgnored] = useState(false);

  // ---------- Data fetching ----------

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(config.apiEndpoint);
      const data = await res.json();
      setAliases(data.aliases || []);
      setUnmatched(data.unmatched || []);
      setIgnored(data.ignored || []);
      setStats({
        rules: (data.aliases || []).length,
        matched: data.matchedCount || 0,
        unmatched: data.unmatchedCount || 0,
        ignored: data.ignoredCount || 0,
      });
      setWarnings(data.warnings || []);
    } finally {
      setLoading(false);
    }
  }, [config.apiEndpoint]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-clear messages
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [message]);

  // ---------- Actions ----------

  const addAlias = async () => {
    if (!newPattern.trim() || !newDisplayName.trim()) return;
    await fetch(config.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: newPattern, matchType: newMatchType, displayName: newDisplayName }),
    });
    setNewPattern(""); setNewDisplayName(""); setShowAddForm(false);
    setMessage({ text: "Rule created", type: "success" });
    fetchData(true);
  };

  const quickRename = async (itemName: string) => {
    if (!renameValue.trim()) return;
    await fetch(config.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: itemName, matchType: "exact", displayName: renameValue }),
    });
    setRenamingItem(null); setRenameValue("");
    setMessage({ text: `Renamed "${itemName}"`, type: "success" });
    fetchData(true);
  };

  const deleteAlias = async (id: string) => {
    await fetch(`${config.apiEndpoint}?id=${id}`, { method: "DELETE" });
    setMessage({ text: "Rule deleted", type: "info" });
    fetchData(true);
  };

  const ignoreItem = async (name: string) => {
    await fetch(config.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", [config.ignoreFieldName]: name }),
    });
    setMessage({ text: `"${name}" ignored`, type: "info" });
    fetchData(true);
  };

  const unignoreItem = async (name: string) => {
    await fetch(config.apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unignore", [config.ignoreFieldName]: name }),
    });
    setMessage({ text: `"${name}" restored`, type: "success" });
    fetchData(true);
  };

  const startEdit = (alias: Alias) => {
    setEditId(alias.id);
    setEditPattern(alias.pattern);
    setEditMatchType(alias.matchType);
    setEditDisplayName(alias.displayName);
  };

  const saveEdit = async () => {
    if (!editId || !editPattern.trim() || !editDisplayName.trim()) return;
    await fetch(config.apiEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, pattern: editPattern, matchType: editMatchType, displayName: editDisplayName }),
    });
    setEditId(null);
    setMessage({ text: "Rule updated", type: "success" });
    fetchData(true);
  };

  // ---------- Computed ----------

  // Group aliases by displayName
  const aliasGroups = useMemo(() => {
    const groups: Record<string, Alias[]> = {};
    for (const a of aliases) {
      (groups[a.displayName] = groups[a.displayName] || []).push(a);
    }
    return groups;
  }, [aliases]);

  // Filtered unmatched
  const filteredUnmatched = useMemo(() => {
    if (!search) return unmatched;
    const q = search.toLowerCase();
    return unmatched.filter((item) => item.name.toLowerCase().includes(q));
  }, [unmatched, search]);

  // Filtered alias groups
  const filteredGroups = useMemo(() => {
    if (!search) return aliasGroups;
    const q = search.toLowerCase();
    const result: Record<string, Alias[]> = {};
    for (const [name, group] of Object.entries(aliasGroups)) {
      if (
        name.toLowerCase().includes(q) ||
        group.some((a) => a.pattern.toLowerCase().includes(q))
      ) {
        result[name] = group;
      }
    }
    return result;
  }, [aliasGroups, search]);

  // Filtered ignored
  const filteredIgnored = useMemo(() => {
    if (!search) return ignored;
    const q = search.toLowerCase();
    return ignored.filter((item) => item.name.toLowerCase().includes(q));
  }, [ignored, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  const groupEntries = Object.entries(filteredGroups).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      {/* Toast message */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all ${
          message.type === "success" ? "bg-emerald-600 text-white" : "bg-gray-700 text-white"
        }`}>
          {message.text}
        </div>
      )}

      {/* Search + Add Rule + Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder={`Search ${config.entityLabel.toLowerCase()}s, rules...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Rule
        </button>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 ml-auto">
          <span><span className="font-bold text-emerald-600">{stats.matched}</span> matched</span>
          <span><span className="font-bold text-amber-600">{stats.unmatched}</span> unmatched</span>
          <span><span className="font-bold text-gray-400">{stats.ignored}</span> ignored</span>
        </div>
      </div>

      {/* Add Rule Form (expandable) */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Pattern</label>
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder={config.patternPlaceholder}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Match</label>
              <select
                value={newMatchType}
                onChange={(e) => setNewMatchType(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="exact">Exact</option>
                <option value="contains">Contains</option>
                <option value="starts_with">Starts With</option>
              </select>
            </div>
            <div className="flex items-center gap-1 text-gray-400">→</div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Display Name</label>
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder={config.displayPlaceholder}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                onKeyDown={(e) => { if (e.key === "Enter") addAlias(); }}
              />
            </div>
            <button
              onClick={addAlias}
              disabled={!newPattern.trim() || !newDisplayName.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
            ⚠ {warnings.length} Conflict{warnings.length > 1 ? "s" : ""}
          </h3>
          <div className="space-y-2">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-red-600 dark:text-red-400 font-medium">{w.aliasDisplayName}</span>
                <span className="text-gray-400">—</span>
                <span className="text-gray-600 dark:text-gray-400">{w.message}</span>
                <button
                  onClick={() => {
                    const alias = aliases.find((a) => a.id === w.aliasId);
                    if (alias) startEdit(alias);
                  }}
                  className="ml-auto text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-medium"
                >
                  Fix
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Rules — compact cards, always visible */}
      {groupEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Active Rules ({groupEntries.length} group{groupEntries.length !== 1 ? "s" : ""})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {groupEntries.map(([displayName, group]) => (
              <div
                key={displayName}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{displayName}</span>
                  <span className="text-[10px] text-gray-400">{group.length} rule{group.length > 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-1">
                  {group.map((alias) =>
                    editId === alias.id ? (
                      <div key={alias.id} className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700 rounded p-1.5">
                        <select
                          value={editMatchType}
                          onChange={(e) => setEditMatchType(e.target.value)}
                          className="border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-[11px] bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                        >
                          <option value="exact">exact</option>
                          <option value="contains">contains</option>
                          <option value="starts_with">starts with</option>
                        </select>
                        <input
                          value={editPattern}
                          onChange={(e) => setEditPattern(e.target.value)}
                          className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-[11px] font-mono bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 min-w-0"
                        />
                        <span className="text-gray-400 text-[10px]">→</span>
                        <input
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          className="w-24 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-[11px] bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                        />
                        <button onClick={saveEdit} className="text-[10px] text-emerald-600 font-medium hover:text-emerald-800">Save</button>
                        <button onClick={() => setEditId(null)} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <div key={alias.id} className="flex items-center gap-1.5 text-xs group">
                        <span className="text-gray-400">←</span>
                        <span className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px]">
                          {alias.matchType.replace("_", " ")}
                        </span>
                        <span className="font-mono text-gray-600 dark:text-gray-300 truncate">
                          {alias.pattern}
                        </span>
                        <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(alias)} className="text-[10px] text-indigo-500 hover:text-indigo-700">edit</button>
                          <button onClick={() => deleteAlias(alias.id)} className="text-[10px] text-red-400 hover:text-red-600">×</button>
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs Attention (unmatched) */}
      {filteredUnmatched.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
            Needs Attention ({filteredUnmatched.length})
          </h3>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-4 py-2 font-medium">{config.entityLabel}</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium text-right">Revenue</th>
                  <th className="px-4 py-2 font-medium text-right w-40"></th>
                </tr>
              </thead>
              <tbody>
                {filteredUnmatched.slice(0, unmatchedVisible).map((item) => (
                  <tr key={item.name} className="border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-2 text-gray-800 dark:text-gray-200">
                      <span className="block truncate max-w-[280px]" title={item.name}>{item.name}</span>
                      {renamingItem === item.name && (
                        <div className="mt-1.5 flex gap-1.5 items-center">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            placeholder="Display name..."
                            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs flex-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") quickRename(item.name);
                              if (e.key === "Escape") setRenamingItem(null);
                            }}
                          />
                          <button
                            onClick={() => quickRename(item.name)}
                            disabled={!renameValue.trim()}
                            className="text-[11px] px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setRenamingItem(null)}
                            className="text-[11px] px-1.5 py-1 text-gray-400 hover:text-gray-600"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{item.qty}</td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{formatCurrency(item.revenue)}</td>
                    <td className="px-4 py-2 text-right">
                      {renamingItem !== item.name && (
                        <span className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => { setRenamingItem(item.name); setRenameValue(""); }}
                            className="text-[11px] px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => ignoreItem(item.name)}
                            className="text-[11px] px-2 py-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
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
            {filteredUnmatched.length > unmatchedVisible && (
              <button
                onClick={() => setUnmatchedVisible((v) => v + PAGE_SIZE)}
                className="w-full py-2 text-xs text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-t border-gray-100 dark:border-gray-700 transition-colors"
              >
                Show {Math.min(PAGE_SIZE, filteredUnmatched.length - unmatchedVisible)} more ({filteredUnmatched.length - unmatchedVisible} remaining)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Ignored — collapsible */}
      {filteredIgnored.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowIgnored(!showIgnored)}
            className="flex items-center gap-2 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide hover:text-gray-600 transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showIgnored ? "rotate-90" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Ignored ({filteredIgnored.length})
          </button>
          {showIgnored && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {filteredIgnored.map((item) => (
                  <div key={item.name} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-gray-400 dark:text-gray-500 truncate max-w-[280px]">{item.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{item.qty} sold · {formatCurrency(item.revenue)}</span>
                      <button
                        onClick={() => unignoreItem(item.name)}
                        className="text-[11px] text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {groupEntries.length === 0 && filteredUnmatched.length === 0 && filteredIgnored.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-sm">No {config.entityLabel.toLowerCase()}s found{search ? ` matching "${search}"` : ""}.</p>
        </div>
      )}
    </div>
  );
}
