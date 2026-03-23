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
  // Local UI state
  editedName?: string;
  editedMatchType?: string;
  editedPattern?: string;
  _showDropdown?: boolean;
}

export default function VendorAliasesPanel() {
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

  // Quick-add from unmatched
  const [quickAddVendor, setQuickAddVendor] = useState<string | null>(null);
  const [quickDisplayName, setQuickDisplayName] = useState("");

  // Smart suggestions
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Section toggles
  const [showAliases, setShowAliases] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  // Pagination
  const PAGE_SIZE = 25;
  const [unmatchedVisible, setUnmatchedVisible] = useState(PAGE_SIZE);
  const [ignoredVisible, setIgnoredVisible] = useState(PAGE_SIZE);

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
    const res = await fetch("/api/vendor-aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    const data = await res.json();
    setMessage(`Updated ${data.updated} of ${data.total} vendors.`);
    fetchData(true);
  };

  // Filter by search query across all sections
  const sq = searchQuery.toLowerCase().trim();
  const filteredAliases = sq
    ? aliases.filter((a) => a.pattern.toLowerCase().includes(sq) || a.displayName.toLowerCase().includes(sq))
    : aliases;
  const filteredUnmatched = sq
    ? unmatched.filter((u) => u.name.toLowerCase().includes(sq))
    : unmatched;
  const filteredIgnored = sq
    ? ignored.filter((i) => i.name.toLowerCase().includes(sq))
    : ignored;

  // Group aliases by displayName for cleaner display
  const aliasGroups = filteredAliases.reduce<Record<string, VendorAlias[]>>((acc, a) => {
    (acc[a.displayName] = acc[a.displayName] || []).push(a);
    return acc;
  }, {});

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className={`space-y-6 transition-opacity ${refreshing ? "opacity-60 pointer-events-none" : ""}`}>
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

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search vendors across all sections..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2.5 pl-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
        {sq && (
          <p className="text-xs text-gray-400 mt-1">
            Found: {Object.keys(aliasGroups).length} aliases, {filteredUnmatched.length} unmatched, {filteredIgnored.length} ignored
          </p>
        )}
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

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-200">
            <h3 className="text-sm font-medium text-red-800">
              Overlapping Groups ({warnings.length})
            </h3>
            <p className="text-xs text-red-600 mt-0.5">
              These vendors match multiple alias rules that map to different groups. Edit the rules to make them more specific.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {warnings.map((w, idx) => (
              <div key={idx} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-red-500" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700">
                        {w.aliasDisplayName}
                      </span>
                      <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">
                        {w.aliasMatchType.replace("_", " ")} &ldquo;{w.aliasPattern}&rdquo;
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mb-1.5">{w.message}</p>
                    {w.affectedItems.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {w.affectedItems.slice(0, 6).map((item) => (
                          <span key={item} className="inline-block px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-mono truncate max-w-[250px]" title={item}>
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
                        setShowAliases(true);
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
              </div>
            ))}
          </div>
        </div>
      )}

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
                      <div key={alias.id} id={`alias-${alias.id}`} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg p-2">
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
                        id={`alias-${alias.id}`}
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

      {/* Smart Suggestions */}
      {suggestionsLoaded && suggestions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-amber-800">
                Suggested Groupings ({suggestions.length})
              </h3>
              <p className="text-xs text-amber-600 mt-0.5">
                Review and accept suggestions, edit names, or ignore vendors.
              </p>
            </div>
            <button
              onClick={fetchSuggestions}
              className="text-xs px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50"
            >
              Refresh
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {suggestions.map((s, idx) => {
              const icon = s.type === "existing_group" ? "📂" : s.type === "new_group" ? "🆕" : "📌";
              const label = s.type === "existing_group" ? "Add to existing group" : s.type === "new_group" ? "New group" : "Solo";
              const displayName = s.editedName ?? s.groupName;
              const matchType = s.editedMatchType ?? s.suggestedMatchType ?? "exact";
              const pattern = s.editedPattern ?? s.suggestedPattern ?? "";

              return (
                <div key={idx} className="px-4 py-3 hover:bg-gray-50">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{icon}</span>
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
                        <span className="text-xs text-gray-500">{s.totalCount} txns</span>
                        <span className={`text-xs ${s.totalAmount < 0 ? "text-emerald-600" : "text-gray-600"}`}>
                          {formatCurrency(s.totalAmount)}
                        </span>
                      </div>

                      {/* Editable display name + match config */}
                      <div className="flex items-end gap-2 mb-2">
                        <div className="relative">
                          <label className="block text-[10px] text-gray-400 mb-0.5">Display Name</label>
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
                            className="border border-gray-300 rounded px-2 py-1 text-sm font-medium w-48"
                          />
                          {s._showDropdown && (() => {
                            const existingNames = [...new Set(aliases.map((a) => a.displayName))].filter((name) =>
                              name.toLowerCase().includes((displayName || "").toLowerCase())
                            ).slice(0, 8);
                            if (existingNames.length === 0) return null;
                            return (
                              <div className="absolute z-10 top-full left-0 mt-0.5 w-48 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
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
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">Match Type</label>
                          <select
                            value={matchType}
                            onChange={(e) => setSuggestions((prev) =>
                              prev.map((p, i) => i === idx ? { ...p, editedMatchType: e.target.value } : p)
                            )}
                            className="border border-gray-300 rounded px-2 py-1 text-xs"
                          >
                            <option value="exact">Exact</option>
                            <option value="starts_with">Starts With</option>
                            <option value="contains">Contains</option>
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] text-gray-400 mb-0.5">Pattern to Match</label>
                          <input
                            type="text"
                            value={pattern}
                            onChange={(e) => setSuggestions((prev) =>
                              prev.map((p, i) => i === idx ? { ...p, editedPattern: e.target.value } : p)
                            )}
                            className="border border-gray-300 rounded px-2 py-1 text-xs font-mono w-full text-gray-500"
                            placeholder="Pattern..."
                          />
                        </div>
                      </div>

                      {/* Members list */}
                      <div className="pl-6 space-y-0.5">
                        {s.members.slice(0, 5).map((m, mi) => (
                          <div key={mi} className="text-xs text-gray-500 flex items-center gap-2">
                            <span className="text-gray-300">•</span>
                            <span className="truncate max-w-[400px]" title={m.name}>{m.name}</span>
                            <span className="text-gray-400">({m.count})</span>
                          </div>
                        ))}
                        {s.members.length > 5 && (
                          <div className="text-xs text-gray-400 pl-4">
                            +{s.members.length - 5} more
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => applySuggestion(s)}
                        className="text-xs px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 font-medium"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => skipSuggestion(s)}
                        className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      >
                        Skip
                      </button>
                      <button
                        onClick={() => ignoreSuggestion(s)}
                        className="text-xs px-3 py-1.5 bg-red-50 text-red-500 rounded hover:bg-red-100"
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {suggestionsLoaded && suggestions.length === 0 && unmatchedCount === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <p className="text-emerald-700 font-medium">All vendors matched!</p>
          <p className="text-xs text-emerald-600 mt-1">No unmatched vendor names found.</p>
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
            <>
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
                {filteredIgnored.slice(0, ignoredVisible).map((v) => (
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
            {ignored.length > ignoredVisible && (
              <button
                onClick={() => setIgnoredVisible((v) => v + PAGE_SIZE)}
                className="w-full py-2.5 text-sm text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
              >
                Load {Math.min(PAGE_SIZE, ignored.length - ignoredVisible)} more ({ignored.length - ignoredVisible} remaining)
              </button>
            )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
