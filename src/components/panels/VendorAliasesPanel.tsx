"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface VendorAlias {
  id: string;
  pattern: string;
  matchType: string;
  displayName: string;
  autoCreated: boolean;
  matchCount?: number;
}

interface UnmatchedVendor {
  id: string;
  name: string;
  expenseCount: number;
  totalSpent: number;
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

interface GroupSuggestion {
  type: "existing_group" | "new_group" | "solo";
  groupName: string;
  suggestedPattern?: string;
  suggestedMatchType?: string;
  existingAliasId?: string;
  members: { name: string; count: number; totalAmount: number }[];
  totalCount: number;
  totalAmount: number;
  editedName?: string;
  editedMatchType?: string;
  editedPattern?: string;
  _showDropdown?: boolean;
}

export default function VendorAliasesPanel() {
  const [tab, setTab] = useState<"aliases" | "review" | "ignored">("aliases");
  const [aliases, setAliases] = useState<VendorAlias[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedVendor[]>([]);
  const [ignored, setIgnored] = useState<UnmatchedVendor[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [warnings, setWarnings] = useState<AliasWarning[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  // Smart suggestions
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination
  const PAGE_SIZE = 25;
  const [ignoredVisible, setIgnoredVisible] = useState(PAGE_SIZE);

  // Expanded suggestion rows
  const [expandedSuggestion, setExpandedSuggestion] = useState<number | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    const res = await fetch("/api/vendor-aliases");
    const data = await res.json();
    setAliases(data.aliases || []);
    setUnmatched(data.unmatched || []);
    setIgnored(data.ignored || []);
    setMatchedCount(data.matchedCount || 0);
    setUnmatchedCount(data.unmatchedCount || 0);
    setIgnoredCount(data.ignoredCount || 0);
    setWarnings(data.warnings || []);
    setInitialLoading(false);
    setRefreshing(false);
  }, []);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor-aliases?action=suggest-groups");
      const data = await res.json();
      setSuggestions(data.suggestions || []);
      setSuggestionsLoaded(true);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchSuggestions();
  }, [fetchData, fetchSuggestions]);

  const applySuggestion = async (suggestion: GroupSuggestion) => {
    const displayName = suggestion.editedName || suggestion.groupName;
    const matchType = suggestion.editedMatchType || suggestion.suggestedMatchType || "exact";
    const pattern = suggestion.editedPattern || suggestion.suggestedPattern || suggestion.members[0]?.name || "";

    setMessage(`Creating alias "${displayName}"...`);
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern, matchType, displayName }),
    });
    setSuggestions((prev) => prev.filter((s) => s !== suggestion));
    setMessage(`"${displayName}" alias created.`);
    fetchData(true);
  };

  const skipSuggestion = (suggestion: GroupSuggestion) => {
    setSuggestions((prev) => prev.filter((s) => s !== suggestion));
  };

  const ignoreSuggestion = async (suggestion: GroupSuggestion) => {
    for (const member of suggestion.members) {
      await fetch("/api/vendor-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignore", vendorName: member.name }),
      });
    }
    setSuggestions((prev) => prev.filter((s) => s !== suggestion));
    setMessage(`${suggestion.members.length} vendor(s) ignored.`);
    fetchData(true);
  };

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
    fetchData(true);
  };

  const deleteAlias = async (id: string) => {
    await fetch(`/api/vendor-aliases?id=${id}`, { method: "DELETE" });
    setMessage("Alias deleted.");
    fetchData(true);
  };

  const ignoreVendor = async (vendorName: string) => {
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", vendorName }),
    });
    setMessage(`"${vendorName}" ignored.`);
    fetchData(true);
  };

  const unignoreVendor = async (vendorName: string) => {
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unignore", vendorName }),
    });
    setMessage(`"${vendorName}" restored.`);
    fetchData(true);
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
    fetchData(true);
  };

  const applyAll = async () => {
    setMessage("Applying aliases to all vendors...");
    await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    setMessage("All aliases re-applied.");
    fetchData(true);
  };

  // Filter by search query
  const sq = searchQuery.toLowerCase().trim();
  const filteredAliases = sq
    ? aliases.filter((a) => a.pattern.toLowerCase().includes(sq) || a.displayName.toLowerCase().includes(sq))
    : aliases;
  const filteredIgnored = sq
    ? ignored.filter((i) => i.name.toLowerCase().includes(sq))
    : ignored;
  const filteredSuggestions = sq
    ? suggestions.filter((s) =>
        s.groupName.toLowerCase().includes(sq) ||
        s.members.some((m) => m.name.toLowerCase().includes(sq))
      )
    : suggestions;

  // Group aliases by displayName
  const aliasGroups = filteredAliases.reduce<Record<string, VendorAlias[]>>((acc, a) => {
    (acc[a.displayName] = acc[a.displayName] || []).push(a);
    return acc;
  }, {});
  const sortedGroups = Object.entries(aliasGroups).sort(([a], [b]) => a.localeCompare(b));

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className={`space-y-4 max-w-4xl mx-auto transition-opacity ${refreshing ? "opacity-50 pointer-events-none" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Vendor Aliases</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {aliases.length} rules &middot; {matchedCount} matched &middot; {unmatchedCount} unmatched
          </p>
        </div>
        <button
          onClick={applyAll}
          className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Re-apply All
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search vendors..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 pl-9 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-700">{message}</p>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-red-50 border-b border-red-200">
            <h3 className="text-sm font-medium text-red-800">
              Overlapping Groups ({warnings.length})
            </h3>
            <p className="text-xs text-red-600 mt-0.5">
              Vendors matching multiple rules with different groups.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {warnings.map((w, idx) => (
              <div key={idx} className="px-4 py-2.5 flex items-start gap-2">
                <span className="shrink-0 mt-1 w-2 h-2 rounded-full bg-red-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700">{w.aliasDisplayName}</span>
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">
                      {w.aliasMatchType.replace("_", " ")} &ldquo;{w.aliasPattern}&rdquo;
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{w.message}</p>
                  {w.affectedItems.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {w.affectedItems.slice(0, 6).map((item) => (
                        <span key={item} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-mono truncate max-w-[250px]" title={item}>
                          {item}
                        </span>
                      ))}
                      {w.affectedItems.length > 6 && (
                        <span className="text-[10px] text-gray-400">+{w.affectedItems.length - 6} more</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    const alias = aliases.find(a => a.id === w.aliasId);
                    if (alias) {
                      setTab("aliases");
                      startEdit(alias);
                      setTimeout(() => {
                        document.getElementById(`alias-${alias.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }, 100);
                    }
                  }}
                  className="shrink-0 text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                >
                  Edit Rule
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {([
          { key: "aliases" as const, label: "Aliases" },
          { key: "review" as const, label: `Review & Match${suggestions.length > 0 ? ` (${suggestions.length})` : ""}` },
          { key: "ignored" as const, label: `Ignored${ignoredCount > 0 ? ` (${ignoredCount})` : ""}` },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t.key
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── ALIASES TAB ─── */}
      {tab === "aliases" && (
        <div className="space-y-4">
          {/* Add Alias Rule */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Add Alias Rule</h3>
            <div className="flex gap-3 items-end flex-wrap">
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
              <span className="text-xs text-gray-400 pb-2.5">maps to</span>
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

          {/* Aliases Table — grouped by displayName */}
          {sortedGroups.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No alias rules yet. Add a rule above or accept suggestions in the Review tab.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedGroups.map(([displayName, group]) => (
                <div key={displayName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700">{displayName}</h4>
                    <span className="text-xs text-gray-400 ml-auto">
                      {group.length} {group.length === 1 ? "rule" : "rules"}
                    </span>
                  </div>
                  {/* Rules table */}
                  <table className="w-full text-sm">
                    <tbody>
                      {group.map((alias) => {
                        const isEditing = editId === alias.id;
                        return (
                          <tr
                            key={alias.id}
                            id={`alias-${alias.id}`}
                            className="border-t border-gray-100 first:border-t-0 hover:bg-gray-50"
                          >
                            {isEditing ? (
                              <td colSpan={4} className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={editMatchType}
                                    onChange={(e) => setEditMatchType(e.target.value)}
                                    className="border border-gray-300 rounded px-1.5 py-0.5 text-xs shrink-0"
                                  >
                                    <option value="starts_with">starts with</option>
                                    <option value="contains">contains</option>
                                    <option value="exact">exact</option>
                                  </select>
                                  <input
                                    type="text"
                                    value={editPattern}
                                    onChange={(e) => setEditPattern(e.target.value)}
                                    className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-0.5 text-xs font-mono"
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveEdit();
                                      if (e.key === "Escape") cancelEdit();
                                    }}
                                    autoFocus
                                  />
                                  <span className="text-xs text-gray-400 shrink-0">maps to</span>
                                  <input
                                    type="text"
                                    value={editDisplayName}
                                    onChange={(e) => setEditDisplayName(e.target.value)}
                                    placeholder="Display Name"
                                    className="w-48 shrink-0 border border-gray-300 rounded px-2 py-0.5 text-xs"
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveEdit();
                                      if (e.key === "Escape") cancelEdit();
                                    }}
                                  />
                                  <button
                                    onClick={saveEdit}
                                    className="text-xs text-emerald-600 hover:text-emerald-800 font-medium shrink-0"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                            ) : (
                              <>
                                <td className="px-4 py-2 w-28 whitespace-nowrap">
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                    {alias.matchType.replace("_", " ")}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-gray-800 font-mono text-xs">
                                  {alias.pattern.length > 60
                                    ? alias.pattern.slice(0, 60) + "..."
                                    : alias.pattern}
                                </td>
                                <td className="px-4 py-2 w-20">
                                  {alias.autoCreated && (
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                                      auto
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right w-28 whitespace-nowrap">
                                  <div className="flex gap-2 justify-end">
                                    <button
                                      onClick={() => startEdit(alias)}
                                      className="text-xs text-indigo-500 hover:text-indigo-700"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => deleteAlias(alias.id)}
                                      className="text-xs text-red-500 hover:text-red-700"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── REVIEW & MATCH TAB ─── */}
      {tab === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-700">Review & Match</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {filteredSuggestions.length} suggestion{filteredSuggestions.length !== 1 ? "s" : ""} to review.
              </p>
            </div>
            <button
              onClick={fetchSuggestions}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Refresh
            </button>
          </div>

          {!suggestionsLoaded ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          ) : filteredSuggestions.length === 0 && unmatchedCount === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
              <p className="text-emerald-700 font-medium">All vendors matched!</p>
              <p className="text-xs text-emerald-600 mt-1">No unmatched vendor names found.</p>
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No suggestions available. Try refreshing or add aliases manually.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500 text-xs">
                    <th className="px-4 py-2.5">Vendor(s)</th>
                    <th className="px-4 py-2.5 text-right">Txns</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5">Display Name</th>
                    <th className="px-4 py-2.5">Match</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuggestions.map((s, idx) => {
                    const displayName = s.editedName ?? s.groupName;
                    const matchType = s.editedMatchType ?? s.suggestedMatchType ?? "exact";
                    const pattern = s.editedPattern ?? s.suggestedPattern ?? "";
                    const isExpanded = expandedSuggestion === idx;

                    return (
                      <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {s.members.length > 1 && (
                              <button
                                onClick={() => setExpandedSuggestion(isExpanded ? null : idx)}
                                className="text-gray-400 hover:text-gray-600 shrink-0"
                              >
                                <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            )}
                            <div>
                              <span className="text-xs font-medium text-gray-800">
                                {s.members[0]?.name || s.groupName}
                              </span>
                              {s.members.length > 1 && (
                                <span className="text-[10px] text-gray-400 ml-1">
                                  +{s.members.length - 1} more
                                </span>
                              )}
                              {isExpanded && (
                                <div className="mt-1 space-y-0.5 pl-1">
                                  {s.members.slice(1).map((m, mi) => (
                                    <div key={mi} className="text-[11px] text-gray-500 flex items-center gap-1.5">
                                      <span className="text-gray-300">&#8226;</span>
                                      <span className="truncate max-w-[250px]" title={m.name}>{m.name}</span>
                                      <span className="text-gray-400">({m.count})</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600 text-xs">{s.totalCount}</td>
                        <td className={`px-4 py-2.5 text-right text-xs ${s.totalAmount < 0 ? "text-emerald-600" : "text-gray-600"}`}>
                          {formatCurrency(s.totalAmount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="relative">
                            <input
                              type="text"
                              value={displayName}
                              onChange={(e) => setSuggestions((prev) =>
                                prev.map((p, i) => i === idx ? { ...p, editedName: e.target.value } : p)
                              )}
                              onFocus={() => setSuggestions((prev) =>
                                prev.map((p, i) => i === idx ? { ...p, _showDropdown: true } : { ...p, _showDropdown: false })
                              )}
                              onBlur={() => setTimeout(() => setSuggestions((prev) =>
                                prev.map((p) => ({ ...p, _showDropdown: false }))
                              ), 200)}
                              className="border border-gray-300 rounded px-2 py-1 text-xs font-medium w-full"
                            />
                            {s._showDropdown && (() => {
                              const existingNames = [...new Set(aliases.map((a) => a.displayName))].filter((name) =>
                                name.toLowerCase().includes((displayName || "").toLowerCase())
                              ).slice(0, 6);
                              if (existingNames.length === 0) return null;
                              return (
                                <div className="absolute z-10 top-full left-0 mt-0.5 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                  {existingNames.map((name) => (
                                    <button
                                      key={name}
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 text-gray-700 hover:text-indigo-700"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        setSuggestions((prev) =>
                                          prev.map((p, i) => i === idx ? { ...p, editedName: name, _showDropdown: false } : p)
                                        );
                                      }}
                                    >
                                      {name}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">
                            <select
                              value={matchType}
                              onChange={(e) => setSuggestions((prev) =>
                                prev.map((p, i) => i === idx ? { ...p, editedMatchType: e.target.value } : p)
                              )}
                              className="border border-gray-300 rounded px-1.5 py-1 text-[11px] w-20"
                            >
                              <option value="exact">exact</option>
                              <option value="starts_with">starts with</option>
                              <option value="contains">contains</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => applySuggestion(s)}
                              className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 font-medium"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => skipSuggestion(s)}
                              className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                            >
                              Skip
                            </button>
                            <button
                              onClick={() => ignoreSuggestion(s)}
                              className="px-2 py-0.5 text-xs bg-red-50 text-red-500 rounded hover:bg-red-100"
                            >
                              Ignore
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── IGNORED TAB ─── */}
      {tab === "ignored" && (
        <div className="space-y-4">
          {ignoredCount === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No ignored vendors.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-2.5 font-medium">Vendor Name</th>
                    <th className="px-4 py-2.5 font-medium text-right">Expenses</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIgnored.slice(0, ignoredVisible).map((v) => (
                    <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600 max-w-[300px]">
                        <span className="block truncate" title={v.name}>
                          {v.name}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{v.expenseCount}</td>
                      <td className="px-4 py-2 text-right text-gray-500">
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
              {filteredIgnored.length > ignoredVisible && (
                <button
                  onClick={() => setIgnoredVisible((v) => v + PAGE_SIZE)}
                  className="w-full py-2.5 text-sm text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
                >
                  Load {Math.min(PAGE_SIZE, filteredIgnored.length - ignoredVisible)} more ({filteredIgnored.length - ignoredVisible} remaining)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
