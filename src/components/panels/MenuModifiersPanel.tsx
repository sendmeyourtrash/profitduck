"use client";

import { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/utils/format";
import AliasManager from "./AliasManager";

interface TopCombo {
  combo: string;
  item: string;
  count: number;
}

interface ModifierStats {
  totalModifiers: number;
  totalItemsWithMods: number;
  totalItems: number;
  modifierRate: number;
  topCombos: TopCombo[];
}

export default function MenuModifiersPanel() {
  const [stats, setStats] = useState<ModifierStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/menu-modifiers")
      .then((r) => r.json())
      .then((data) => {
        setStats({
          totalModifiers: data.totalModifiers || 0,
          totalItemsWithMods: data.totalItemsWithMods || 0,
          totalItems: data.totalItems || 0,
          modifierRate: data.modifierRate || 0,
          topCombos: data.topCombos || [],
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats header */}
      {stats && (
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span><span className="font-bold text-gray-900 dark:text-gray-100">{stats.totalModifiers}</span> modifiers</span>
          <span><span className="font-bold text-indigo-600 dark:text-indigo-400">{stats.modifierRate}%</span> of items modified</span>
          <span><span className="font-bold text-gray-900 dark:text-gray-100">{stats.totalItemsWithMods.toLocaleString()}</span> items w/ mods</span>
        </div>
      )}

      {/* Top combos */}
      {stats && stats.topCombos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            Popular Combos
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {stats.topCombos.slice(0, 9).map((c, i) => (
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

      {/* Alias manager for modifiers */}
      <AliasManager
        config={{
          apiEndpoint: "/api/menu-modifiers",
          entityLabel: "Modifier",
          patternPlaceholder: "e.g. Heated",
          displayPlaceholder: "e.g. Hot",
          ignoreFieldName: "modifierName",
        }}
      />
    </div>
  );
}
