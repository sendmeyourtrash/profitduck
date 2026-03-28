"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { bigramSimilarity } from "@/lib/utils/string-similarity";

// ---------- Types ----------

interface Alias {
  id: string;
  pattern: string;
  matchType: string;
  displayName: string;
}

interface Suggestion { displayName: string; score: number; }

interface UnmatchedItem {
  name: string;
  qty: number;
  revenue: number;
  suggestions?: Suggestion[];
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

interface PreviewMatch {
  name: string;
  qty: number;
  alreadyMatched: boolean;
  existingGroup?: string;
}

export interface AliasManagerConfig {
  apiEndpoint: string;
  entityLabel: string;
  patternPlaceholder: string;
  displayPlaceholder: string;
  ignoreFieldName: string;
}

// ---------- Component ----------

export default function AliasManager({ config }: { config: AliasManagerConfig }) {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [ignored, setIgnored] = useState<UnmatchedItem[]>([]);
  const [stats, setStats] = useState({ rules: 0, matched: 0, unmatched: 0, ignored: 0 });
  const [warnings, setWarnings] = useState<AliasWarning[]>([]);
  const [groupStats, setGroupStats] = useState<Record<string, { qty: number; revenue: number }>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null);

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"name" | "qty" | "revenue">("qty");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupSortField, setGroupSortField] = useState<"name" | "qty" | "revenue">("revenue");
  const [groupSortDir, setGroupSortDir] = useState<"asc" | "desc">("desc");

  // Add rule
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newMatchType, setNewMatchType] = useState("exact");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [previewMatches, setPreviewMatches] = useState<PreviewMatch[] | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editMatchType, setEditMatchType] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  // Quick rename
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showRenameSuggestions, setShowRenameSuggestions] = useState(false);
  const renameDropdownRef = useRef<HTMLDivElement>(null);

  // Group actions
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null);

  // Expand
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  // Pagination
  const PAGE_SIZE = 25;
  const [unmatchedVisible, setUnmatchedVisible] = useState(PAGE_SIZE);

  // ---------- Data ----------

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(config.apiEndpoint);
      const data = await res.json();
      setAliases(data.aliases || []);
      setUnmatched(data.unmatched || []);
      setIgnored(data.ignored || []);
      setStats({ rules: (data.aliases || []).length, matched: data.matchedCount || 0, unmatched: data.unmatchedCount || 0, ignored: data.ignoredCount || 0 });
      setWarnings(data.warnings || []);
      setGroupStats(data.groupStats || {});
    } finally { setLoading(false); }
  }, [config.apiEndpoint]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), message.type === "error" ? 6000 : 3000); return () => clearTimeout(t); }
  }, [message]);

  // Preview
  useEffect(() => {
    if (!showAddForm || !newPattern.trim()) { setPreviewMatches(null); return; }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ preview: "1", pattern: newPattern, matchType: newMatchType });
        const res = await fetch(`${config.apiEndpoint}?${params}`);
        const data = await res.json();
        setPreviewMatches(data.matches || []);
      } catch { setPreviewMatches(null); }
    }, 300);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [newPattern, newMatchType, showAddForm, config.apiEndpoint]);

  // Close rename dropdown
  useEffect(() => {
    if (!showRenameSuggestions) return;
    function onMouseDown(e: MouseEvent) {
      if (renameDropdownRef.current && !renameDropdownRef.current.contains(e.target as Node)) setShowRenameSuggestions(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showRenameSuggestions]);

  // ---------- Actions ----------

  const addAlias = async () => {
    if (!newPattern.trim() || !newDisplayName.trim()) return;
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: newPattern, matchType: newMatchType, displayName: newDisplayName }) });
    setNewPattern(""); setNewDisplayName(""); setShowAddForm(false); setPreviewMatches(null);
    setMessage({ text: "Rule created", type: "success" }); fetchData(true);
  };

  const quickRename = async (itemName: string) => {
    if (!renameValue.trim()) return;
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: itemName, matchType: "exact", displayName: renameValue }) });
    setRenamingItem(null); setRenameValue(""); setShowRenameSuggestions(false);
    setMessage({ text: `Renamed "${itemName}"`, type: "success" }); fetchData(true);
  };

  const quickAssign = async (itemName: string, displayName: string) => {
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: itemName, matchType: "exact", displayName }) });
    setMessage({ text: `"${itemName}" → "${displayName}"`, type: "success" }); fetchData(true);
  };

  const confirmItem = async (itemName: string) => {
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: itemName, matchType: "exact", displayName: itemName }) });
    setMessage({ text: `Confirmed "${itemName}"`, type: "success" }); fetchData(true);
  };

  const deleteAlias = async (id: string) => {
    await fetch(`${config.apiEndpoint}?id=${id}`, { method: "DELETE" });
    setMessage({ text: "Rule deleted", type: "info" }); fetchData(true);
  };

  const ignoreItem = async (name: string) => {
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", [config.ignoreFieldName]: name }) });
    setMessage({ text: `"${name}" ignored`, type: "info" }); fetchData(true);
  };

  const unignoreItem = async (name: string) => {
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unignore", [config.ignoreFieldName]: name }) });
    setMessage({ text: `"${name}" restored`, type: "success" }); fetchData(true);
  };

  const startEdit = (alias: Alias) => {
    setEditId(alias.id); setEditPattern(alias.pattern); setEditMatchType(alias.matchType); setEditDisplayName(alias.displayName);
  };

  const saveEdit = async () => {
    if (!editId || !editPattern.trim() || !editDisplayName.trim()) return;
    await fetch(config.apiEndpoint, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editId, pattern: editPattern, matchType: editMatchType, displayName: editDisplayName }) });
    setEditId(null); setMessage({ text: "Rule updated", type: "success" }); fetchData(true);
  };

  const deleteGroup = async (displayName: string) => {
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-group", displayName }) });
    setConfirmDeleteGroup(null);
    if (expandedGroup === displayName) setExpandedGroup(null);
    setMessage({ text: `Deleted group "${displayName}"`, type: "info" }); fetchData(true);
  };

  const renameGroup = async (oldName: string) => {
    if (!renameGroupValue.trim() || renameGroupValue === oldName) return;
    await fetch(config.apiEndpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename-group", oldName, newName: renameGroupValue }) });
    setRenamingGroup(null); setRenameGroupValue("");
    setMessage({ text: `Renamed "${oldName}" → "${renameGroupValue}"`, type: "success" }); fetchData(true);
  };

  const toggleSort = (field: "name" | "qty" | "revenue") => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir(field === "name" ? "asc" : "desc"); }
  };

  // ---------- Computed ----------

  const aliasGroups = useMemo(() => {
    const groups: Record<string, Alias[]> = {};
    for (const a of aliases) (groups[a.displayName] = groups[a.displayName] || []).push(a);
    return groups;
  }, [aliases]);

  const aliasGroupNames = useMemo(() => [...new Set(aliases.map((a) => a.displayName))], [aliases]);

  const filteredUnmatched = useMemo(() => {
    if (!search) return unmatched;
    const q = search.toLowerCase();
    return unmatched.filter((item) => item.name.toLowerCase().includes(q));
  }, [unmatched, search]);

  const sortedUnmatched = useMemo(() => {
    const items = [...filteredUnmatched];
    items.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name);
      else if (sortField === "qty") cmp = a.qty - b.qty;
      else cmp = a.revenue - b.revenue;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [filteredUnmatched, sortField, sortDir]);

  const filteredGroups = useMemo(() => {
    if (!search) return aliasGroups;
    const q = search.toLowerCase();
    const result: Record<string, Alias[]> = {};
    for (const [name, group] of Object.entries(aliasGroups)) {
      if (name.toLowerCase().includes(q) || group.some((a) => a.pattern.toLowerCase().includes(q))) result[name] = group;
    }
    return result;
  }, [aliasGroups, search]);

  const filteredIgnored = useMemo(() => {
    if (!search) return ignored;
    const q = search.toLowerCase();
    return ignored.filter((item) => item.name.toLowerCase().includes(q));
  }, [ignored, search]);

  const renameSuggestions = useMemo(() => {
    if (!renamingItem) return [];
    return aliasGroupNames.map((name) => ({ name, score: bigramSimilarity(renamingItem, name) }))
      .sort((a, b) => b.score - a.score);
  }, [renamingItem, aliasGroupNames]);

  const filteredRenameSuggestions = useMemo(() => {
    if (!renameValue) return renameSuggestions.slice(0, 12);
    const q = renameValue.toLowerCase();
    return renameSuggestions.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 12);
  }, [renameSuggestions, renameValue]);

  const previewSummary = useMemo(() => {
    if (!previewMatches) return null;
    return { total: previewMatches.length, newMatches: previewMatches.filter((m) => !m.alreadyMatched).length, conflicts: previewMatches.filter((m) => m.alreadyMatched).length };
  }, [previewMatches]);

  const groupEntries = useMemo(() => {
    const entries = Object.entries(filteredGroups);
    entries.sort(([aName, aGroup], [bName, bGroup]) => {
      let cmp = 0;
      if (groupSortField === "name") {
        cmp = aName.localeCompare(bName);
      } else if (groupSortField === "qty") {
        cmp = (groupStats[aName]?.qty || 0) - (groupStats[bName]?.qty || 0);
      } else {
        cmp = (groupStats[aName]?.revenue || 0) - (groupStats[bName]?.revenue || 0);
      }
      return groupSortDir === "asc" ? cmp : -cmp;
    });
    return entries;
  }, [filteredGroups, groupSortField, groupSortDir, groupStats]);

  const topGroups = useMemo(() => {
    return Object.entries(groupStats)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 3);
  }, [groupStats]);

  const totalItems = stats.matched + stats.unmatched;

  const toggleGroupSort = (field: "name" | "qty" | "revenue") => {
    if (groupSortField === field) setGroupSortDir(d => d === "asc" ? "desc" : "asc");
    else { setGroupSortField(field); setGroupSortDir(field === "name" ? "asc" : "desc"); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          message.type === "success" ? "bg-emerald-600 text-white" : message.type === "error" ? "bg-red-600 text-white" : "bg-gray-800 text-white"
        }`}>{message.text}</div>
      )}

      {/* Top bar: stats + actions */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10">
            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-gray-200 dark:stroke-gray-700" />
              <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
                className="stroke-emerald-500" strokeDasharray={`${totalItems > 0 ? (stats.matched / totalItems) * 97.4 : 0} 97.4`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-900 dark:text-gray-100">
              {totalItems > 0 ? Math.round((stats.matched / totalItems) * 100) : 0}%
            </span>
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stats.matched} matched</span>
            <div className="flex gap-3 text-[11px] text-gray-400">
              {stats.unmatched > 0 && <span className="text-amber-500">{stats.unmatched} unmatched</span>}
              {stats.ignored > 0 && <span>{stats.ignored} ignored</span>}
              <span>{groupEntries.length} groups</span>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input type="text" placeholder={`Search ${config.entityLabel.toLowerCase()}s...`}
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 placeholder:text-gray-400" />
        </div>

        <button onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shrink-0">
          + Add Rule
        </button>
      </div>

      {/* Add Rule Form */}
      {showAddForm && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-indigo-200 dark:border-indigo-800/50 p-4 space-y-3">
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Pattern</label>
              <input type="text" value={newPattern} onChange={(e) => setNewPattern(e.target.value)}
                placeholder={config.patternPlaceholder} autoFocus
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Match</label>
              <select value={newMatchType} onChange={(e) => setNewMatchType(e.target.value)}
                className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="exact">Exact</option><option value="contains">Contains</option><option value="starts_with">Starts With</option>
              </select>
            </div>
            <span className="text-gray-300 dark:text-gray-600 pb-2">→</span>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Display Name</label>
              <input type="text" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder={config.displayPlaceholder} onKeyDown={(e) => { if (e.key === "Enter") addAlias(); }}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50" />
            </div>
            <button onClick={addAlias} disabled={!newPattern.trim() || !newDisplayName.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium">Save</button>
            <button onClick={() => { setShowAddForm(false); setPreviewMatches(null); }}
              className="px-3 py-2 text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
          </div>
          {previewMatches && previewMatches.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
              {previewSummary && <p className="text-[11px] text-gray-400 mb-1.5">
                Matches <span className="font-bold">{previewSummary.total}</span> item{previewSummary.total !== 1 ? "s" : ""}
                {previewSummary.newMatches > 0 && <span className="text-emerald-500"> ({previewSummary.newMatches} new)</span>}
                {previewSummary.conflicts > 0 && <span className="text-amber-500"> ({previewSummary.conflicts} existing)</span>}
              </p>}
              <div className="flex flex-wrap gap-1">
                {previewMatches.slice(0, 20).map((m) => (
                  <span key={m.name} className={`text-[10px] px-2 py-0.5 rounded-full ${
                    m.alreadyMatched ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  }`}>{m.name}</span>
                ))}
              </div>
            </div>
          )}
          {previewMatches && previewMatches.length === 0 && newPattern.trim() && (
            <p className="text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-2">No matches.</p>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-xl p-3 space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span className="text-red-700 dark:text-red-300 font-medium">{w.aliasDisplayName}</span>
              <span className="text-gray-500 dark:text-gray-400 truncate">{w.message}</span>
              <button onClick={() => { const a = aliases.find((a) => a.id === w.aliasId); if (a) startEdit(a); }}
                className="ml-auto text-indigo-600 dark:text-indigo-400 font-medium shrink-0">Fix</button>
            </div>
          ))}
        </div>
      )}

      {/* Top items overview */}
      {topGroups.length > 0 && (
        <div className="flex gap-3">
          {topGroups.map(([name, gs], i) => (
            <div key={name} className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${i === 0 ? "text-amber-500" : i === 1 ? "text-gray-400" : "text-amber-700"}`}>#{i + 1}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{name}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{formatCurrency(gs.revenue)}</span>
                <span className="text-xs text-gray-400">{gs.qty.toLocaleString()} sold</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        <div className={(sortedUnmatched.length > 0 || filteredIgnored.length > 0) ? "md:w-1/2" : "w-full"}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[700px] overflow-y-auto">
            {/* Sort header */}
            <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700 text-[11px] font-medium text-gray-400 sticky top-0 bg-white dark:bg-gray-800 z-10">
              <span className="w-6" />
              <button onClick={() => toggleGroupSort("name")} className="flex-1 text-left hover:text-gray-600 transition-colors">
                Name {groupSortField === "name" && <span className="text-indigo-500">{groupSortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
              <button onClick={() => toggleGroupSort("qty")} className="w-12 text-right hover:text-gray-600 transition-colors">
                Qty {groupSortField === "qty" && <span className="text-indigo-500">{groupSortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
              <button onClick={() => toggleGroupSort("revenue")} className="w-24 text-right hover:text-gray-600 transition-colors">
                Revenue {groupSortField === "revenue" && <span className="text-indigo-500">{groupSortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
              <span className="w-16" />
            </div>
            {groupEntries.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No rules{search ? ` matching "${search}"` : ""}.</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {groupEntries.map(([displayName, group]) => {
                  const isOpen = expandedGroup === displayName;
              return (
                <div key={displayName}>
                  {/* Row */}
                  <div
                    className={`flex items-center px-4 py-2.5 cursor-pointer transition-colors ${
                      isOpen ? "bg-indigo-50/50 dark:bg-indigo-900/10" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    }`}
                    onClick={() => setExpandedGroup(isOpen ? null : displayName)}
                  >
                    <div className="w-6 shrink-0 flex items-center justify-center">
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    {renamingGroup === displayName ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input value={renameGroupValue} onChange={(e) => setRenameGroupValue(e.target.value)}
                          className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 min-w-0"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") renameGroup(displayName); if (e.key === "Escape") setRenamingGroup(null); }} />
                        <button onClick={() => renameGroup(displayName)} disabled={!renameGroupValue.trim() || renameGroupValue === displayName}
                          className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium shrink-0">Save</button>
                        <button onClick={() => setRenamingGroup(null)}
                          className="text-xs text-gray-400 px-1.5 shrink-0">✕</button>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{displayName}</span>
                        <span className="text-[10px] text-gray-400 shrink-0">{group.length}</span>
                      </div>
                    )}
                    {confirmDeleteGroup === displayName ? (
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[11px] text-red-400">Delete?</span>
                        <button onClick={() => deleteGroup(displayName)}
                          className="text-[11px] px-2.5 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Yes</button>
                        <button onClick={() => setConfirmDeleteGroup(null)}
                          className="text-[11px] px-2.5 py-1 text-gray-400 hover:text-gray-600">No</button>
                      </div>
                    ) : renamingGroup !== displayName ? (
                      <>
                        <span className="text-xs text-gray-400 w-12 text-right shrink-0">{(groupStats[displayName]?.qty || 0).toLocaleString()}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-24 text-right font-medium shrink-0">{formatCurrency(groupStats[displayName]?.revenue || 0)}</span>
                        <div className="w-16 flex items-center justify-end shrink-0">
                          {isOpen && (
                            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => { setRenamingGroup(displayName); setRenameGroupValue(displayName); }}
                                className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors" title="Rename group">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                </svg>
                              </button>
                              <button onClick={() => setConfirmDeleteGroup(displayName)}
                                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors" title="Delete group">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>

                  {/* Expanded */}
                  {isOpen && (
                    <div className="bg-gray-50/50 dark:bg-gray-900/20 px-4 py-2 space-y-1 border-t border-gray-100 dark:border-gray-700/50">
                      {group.map((alias) =>
                        editId === alias.id ? (
                          <div key={alias.id} className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                            <select value={editMatchType} onChange={(e) => setEditMatchType(e.target.value)}
                              className="border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-[11px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              <option value="exact">exact</option><option value="contains">contains</option><option value="starts_with">starts with</option>
                            </select>
                            <input value={editPattern} onChange={(e) => setEditPattern(e.target.value)}
                              className="flex-1 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-[11px] font-mono bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 min-w-0" />
                            <span className="text-gray-300 text-xs">→</span>
                            <input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)}
                              className="w-28 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-[11px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
                            <button onClick={saveEdit} className="text-[11px] text-emerald-600 font-medium px-2 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded">Save</button>
                            <button onClick={() => setEditId(null)} className="text-[11px] text-gray-400 px-1 py-1">Cancel</button>
                          </div>
                        ) : (
                          <div key={alias.id} className="group/r flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-white dark:hover:bg-gray-800/50 transition-colors">
                            <span className="px-1.5 py-0.5 rounded bg-gray-200/60 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] shrink-0">
                              {alias.matchType === "exact" ? "=" : alias.matchType === "contains" ? "~" : "^"}
                            </span>
                            <span className="font-mono text-gray-600 dark:text-gray-300 truncate">{alias.pattern}</span>
                            <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/r:opacity-100 transition-opacity shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); startEdit(alias); }}
                                className="p-1 text-gray-400 hover:text-indigo-600 rounded transition-colors" title="Edit">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                </svg>
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); deleteAlias(alias.id); }}
                                className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors" title="Delete">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </div>
        </div>

        {/* Right: Unmatched + Ignored */}
        {(sortedUnmatched.length > 0 || filteredIgnored.length > 0) && (
        <div className="md:w-1/2 space-y-3">
          {/* Unmatched */}
      {sortedUnmatched.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-1">
            Unmatched ({filteredUnmatched.length})
          </h3>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-visible">
            {/* Header */}
            <div className="flex items-center px-4 py-2 border-b border-gray-100 dark:border-gray-700 text-[11px] font-medium text-gray-400">
              <button onClick={() => toggleSort("name")} className="flex-1 text-left hover:text-gray-600 transition-colors">
                Name {sortField === "name" && <span className="text-indigo-500">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
              <button onClick={() => toggleSort("qty")} className="w-14 text-right hover:text-gray-600 transition-colors">
                Qty {sortField === "qty" && <span className="text-indigo-500">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
              <button onClick={() => toggleSort("revenue")} className="w-20 text-right hover:text-gray-600 transition-colors">
                Rev {sortField === "revenue" && <span className="text-indigo-500">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
            </div>

            <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
              {sortedUnmatched.slice(0, unmatchedVisible).map((item) => (
                <div key={item.name} className="px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                  {/* Top row: name + stats */}
                  <div className="flex items-center">
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate flex-1 min-w-0">{item.name}</span>
                    <span className="text-xs text-gray-400 w-14 text-right shrink-0">{item.qty}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right shrink-0">{formatCurrency(item.revenue)}</span>
                  </div>
                  {/* Suggestions row */}
                  {item.suggestions && item.suggestions.length > 0 && renamingItem !== item.name && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {item.suggestions.map((s) => (
                        <button key={s.displayName} onClick={() => quickAssign(item.name, s.displayName)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            s.score > 0.7 ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                              : "bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-100"
                          }`}>→ {s.displayName}</button>
                      ))}
                    </div>
                  )}
                  {/* Rename input */}
                  {renamingItem === item.name && (
                    <div ref={renameDropdownRef} className="mt-2 relative">
                      <div className="flex gap-1.5 items-center min-w-0">
                        <input type="text" value={renameValue}
                          onChange={(e) => { setRenameValue(e.target.value); setShowRenameSuggestions(true); }}
                          onFocus={() => setShowRenameSuggestions(true)}
                          placeholder="Display name..." autoFocus
                          className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs flex-1 min-w-0 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                          onKeyDown={(e) => { if (e.key === "Enter") quickRename(item.name); if (e.key === "Escape") { setRenamingItem(null); setShowRenameSuggestions(false); } }} />
                        <button onClick={() => quickRename(item.name)} disabled={!renameValue.trim()}
                          className="text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium shrink-0">Save</button>
                        <button onClick={() => { setRenamingItem(null); setShowRenameSuggestions(false); }}
                          className="text-xs text-gray-400 px-1.5 shrink-0">✕</button>
                      </div>
                      {showRenameSuggestions && filteredRenameSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-36 overflow-y-auto">
                          {filteredRenameSuggestions.map((s) => (
                            <button key={s.name} onClick={() => { setRenameValue(s.name); setShowRenameSuggestions(false); }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between">
                              <span className="text-gray-800 dark:text-gray-200">{s.name}</span>
                              <span className="text-[10px] text-gray-400">{Math.round(s.score * 100)}%</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Action buttons - own row */}
                  {renamingItem !== item.name && (
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => confirmItem(item.name)}
                        className="text-[11px] px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors font-medium">Confirm</button>
                      <button onClick={() => { setRenamingItem(item.name); setRenameValue(""); setShowRenameSuggestions(true); }}
                        className="text-[11px] px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors font-medium">Rename</button>
                      <button onClick={() => ignoreItem(item.name)}
                        className="text-[11px] px-3 py-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-600 transition-colors">Ignore</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {filteredUnmatched.length > unmatchedVisible && (
              <button onClick={() => setUnmatchedVisible((v) => v + PAGE_SIZE)}
                className="w-full py-2.5 text-xs text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-t border-gray-100 dark:border-gray-700 transition-colors font-medium">
                Show more ({filteredUnmatched.length - unmatchedVisible} remaining)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Ignored */}
      {filteredIgnored.length > 0 && (
        <div>
          <button onClick={() => setShowIgnored(!showIgnored)}
            className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors px-1">
            <svg className={`w-3 h-3 transition-transform ${showIgnored ? "rotate-90" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            Ignored ({filteredIgnored.length})
          </button>
          {showIgnored && (
            <div className="mt-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700/50">
              {filteredIgnored.map((item) => (
                <div key={item.name} className="flex items-center px-4 py-2 text-sm">
                  <span className="flex-1 text-gray-400 truncate">{item.name}</span>
                  <span className="text-[11px] text-gray-400 mr-3">{item.qty} · {formatCurrency(item.revenue)}</span>
                  <button onClick={() => unignoreItem(item.name)}
                    className="text-[11px] text-gray-400 hover:text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </div>
        )}
      </div>
    </div>
  );
}
