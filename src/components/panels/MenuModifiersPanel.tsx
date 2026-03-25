"use client";

import { useState, useEffect, useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface Modifier {
  name: string;
  count: number;
  revenue: number;
  itemCount: number;
  topItems: { item: string; count: number }[];
}

interface TopCombo {
  combo: string;
  item: string;
  count: number;
}

interface ModifierData {
  modifiers: Modifier[];
  totalModifiers: number;
  totalItemsWithMods: number;
  totalItems: number;
  modifierRate: number;
  topCombos: TopCombo[];
}

export default function MenuModifiersPanel() {
  const [data, setData] = useState<ModifierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedMod, setExpandedMod] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/menu-modifiers")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data.modifiers;
    const q = search.toLowerCase();
    return data.modifiers.filter((m) => m.name.toLowerCase().includes(q));
  }, [data, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Stats + Search bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search modifiers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 ml-auto">
          <span><span className="font-bold text-gray-900 dark:text-gray-100">{data.totalModifiers}</span> modifiers</span>
          <span><span className="font-bold text-indigo-600 dark:text-indigo-400">{data.modifierRate}%</span> of items modified</span>
          <span><span className="font-bold text-gray-900 dark:text-gray-100">{data.totalItemsWithMods.toLocaleString()}</span> items w/ mods</span>
        </div>
      </div>

      {/* Top combos */}
      {data.topCombos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Popular Combos
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {data.topCombos.slice(0, 9).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <span className="text-gray-400 w-4 shrink-0">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 dark:text-gray-200 truncate">{c.combo}</p>
                  <p className="text-gray-400 dark:text-gray-500 truncate">{c.item}</p>
                </div>
                <span className="text-gray-500 dark:text-gray-400 shrink-0">{c.count.toLocaleString()}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modifier list */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          All Modifiers ({filtered.length})
        </h3>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                <th className="px-4 py-2 font-medium">Modifier</th>
                <th className="px-4 py-2 font-medium text-right">Uses</th>
                <th className="px-4 py-2 font-medium text-right">Revenue</th>
                <th className="px-4 py-2 font-medium text-right">Items</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((mod) => (
                <tr key={mod.name} className="group">
                  <td colSpan={4} className="p-0">
                    <div
                      className="flex items-center px-4 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-t border-gray-50 dark:border-gray-700/50"
                      onClick={() => setExpandedMod(expandedMod === mod.name ? null : mod.name)}
                    >
                      <span className="flex-1 font-medium text-gray-800 dark:text-gray-200">
                        {mod.name}
                        <span className="ml-1 text-gray-400 text-xs">{expandedMod === mod.name ? "▾" : "▸"}</span>
                      </span>
                      <span className="w-20 text-right text-gray-600 dark:text-gray-400">{mod.count.toLocaleString()}</span>
                      <span className="w-24 text-right text-gray-600 dark:text-gray-400">{formatCurrency(mod.revenue)}</span>
                      <span className="w-16 text-right text-gray-600 dark:text-gray-400">{mod.itemCount}</span>
                    </div>
                    {expandedMod === mod.name && (
                      <div className="px-4 pb-3 pt-1">
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5 uppercase tracking-wide">Used with:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {mod.topItems.map((ti) => (
                            <span key={ti.item} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded px-2 py-0.5">
                              {ti.item} <span className="text-gray-400">({ti.count}×)</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 50 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 text-center">
              Showing 50 of {filtered.length}. Use search to filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
