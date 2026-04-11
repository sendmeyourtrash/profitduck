"use client";

/**
 * /tools/mortgage/scenarios — Scenario comparison.
 *
 * Build up to 3 named scenarios (e.g. "Rent in City", "Buy in Suburb",
 * "Buy in City") and see them stacked side-by-side on a bar chart plus a
 * comparison table with a plain-English verdict.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import FormField from "@/components/mortgage/FormField";
import SectionCard from "@/components/mortgage/SectionCard";
import StatTile from "@/components/mortgage/StatTile";
import {
  useMortgageTool,
  type SavedScenario,
} from "@/contexts/MortgageToolContext";
import { compareScenarios } from "@/lib/utils/lifestyle-math";
import { formatCurrency } from "@/lib/utils/format";
import { useTheme } from "@/contexts/ThemeContext";

const PRESETS: SavedScenario[] = [
  {
    id: "rent-city",
    label: "Rent in City",
    housing: 36_000,
    transportation: 2_000,
    taxes: 12_000,
    livingCosts: 28_000,
  },
  {
    id: "buy-city",
    label: "Buy in City",
    housing: 48_000,
    transportation: 2_500,
    taxes: 14_000,
    livingCosts: 27_000,
  },
  {
    id: "buy-suburb",
    label: "Buy in Suburb",
    housing: 34_000,
    transportation: 9_500,
    taxes: 9_000,
    livingCosts: 23_000,
  },
];

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function ScenariosPage() {
  const { state, setScenarios, hydrated } = useMortgageTool();
  const { theme } = useTheme();

  const comparison = useMemo(
    () => compareScenarios(state.scenarios),
    [state.scenarios]
  );

  const addScenario = () => {
    if (state.scenarios.length >= 3) return;
    setScenarios([
      ...state.scenarios,
      {
        id: uid(),
        label: `Scenario ${state.scenarios.length + 1}`,
        housing: 0,
        transportation: 0,
        taxes: 0,
        livingCosts: 0,
      },
    ]);
  };

  const loadPresets = () => {
    setScenarios(PRESETS.map((p) => ({ ...p, id: uid() })));
  };

  const removeScenario = (id: string) => {
    setScenarios(state.scenarios.filter((s) => s.id !== id));
  };

  const updateScenario = (id: string, patch: Partial<SavedScenario>) => {
    setScenarios(
      state.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };

  const chartData = useMemo(
    () =>
      comparison.scenarios.map((s) => ({
        name: s.label,
        Housing: Math.round(s.housing),
        Transportation: Math.round(s.transportation),
        Taxes: Math.round(s.taxes),
        "Living Costs": Math.round(s.livingCosts),
      })),
    [comparison.scenarios]
  );

  const gridStroke = theme === "dark" ? "#374151" : "#e5e7eb";
  const axisStroke = theme === "dark" ? "#6b7280" : "#9ca3af";

  if (!hydrated) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Empty state ──────────────────────────────────────────── */}
      {state.scenarios.length === 0 && (
        <SectionCard title="Build Scenarios to Compare">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
            Compare up to 3 lifestyle choices side-by-side. Each scenario is
            an annual cost broken into Housing, Transportation, Taxes, and
            Living Costs. You can enter your own or start with presets.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadPresets}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Load Presets
            </button>
            <button
              type="button"
              onClick={addScenario}
              className="px-4 py-2 text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Start Blank
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Scenario inputs ───────────────────────────────────────── */}
      {state.scenarios.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.scenarios.map((scenario) => (
              <SectionCard
                key={scenario.id}
                title={scenario.label || "Unnamed"}
                action={
                  <button
                    type="button"
                    onClick={() => removeScenario(scenario.id)}
                    className="text-[11px] text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-2 py-1"
                    aria-label={`Remove ${scenario.label}`}
                  >
                    Remove
                  </button>
                }
                compact
              >
                <div className="space-y-3">
                  <FormField
                    label="Label"
                    type="text"
                    value={scenario.label}
                    onChange={(v) =>
                      updateScenario(scenario.id, { label: v })
                    }
                  />
                  <FormField
                    label="Housing (yr)"
                    prefix="$"
                    value={scenario.housing}
                    onChange={(v) =>
                      updateScenario(scenario.id, { housing: v })
                    }
                    step={500}
                    min={0}
                    helperText="PITI × 12, less tax savings."
                  />
                  <FormField
                    label="Transportation (yr)"
                    prefix="$"
                    value={scenario.transportation}
                    onChange={(v) =>
                      updateScenario(scenario.id, { transportation: v })
                    }
                    step={100}
                    min={0}
                  />
                  <FormField
                    label="Taxes (yr)"
                    prefix="$"
                    value={scenario.taxes}
                    onChange={(v) =>
                      updateScenario(scenario.id, { taxes: v })
                    }
                    step={500}
                    min={0}
                    helperText="Federal + state income + property."
                  />
                  <FormField
                    label="Living Costs (yr)"
                    prefix="$"
                    value={scenario.livingCosts}
                    onChange={(v) =>
                      updateScenario(scenario.id, { livingCosts: v })
                    }
                    step={500}
                    min={0}
                    helperText="Groceries, utilities, entertainment."
                  />
                  <div className="pt-2 border-t border-gray-200/50 dark:border-gray-700/50">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Annual total
                    </p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      {formatCurrency(
                        scenario.housing +
                          scenario.transportation +
                          scenario.taxes +
                          scenario.livingCosts
                      )}
                    </p>
                  </div>
                </div>
              </SectionCard>
            ))}
          </div>

          {/* ── Add / preset buttons ───────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            {state.scenarios.length < 3 && (
              <button
                type="button"
                onClick={addScenario}
                className="px-4 py-2 text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                + Add Scenario
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirm("Clear all scenarios?")) setScenarios([]);
              }}
              className="px-4 py-2 text-sm font-medium bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-xl border border-gray-200 dark:border-gray-700 hover:text-red-600 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Clear All
            </button>
          </div>

          {/* ── Comparison chart ───────────────────────────────── */}
          {state.scenarios.length >= 2 && (
            <>
              <SectionCard title="Side-by-side Comparison">
                <div
                  className="h-80"
                  role="img"
                  aria-label="Stacked bar chart comparing scenario costs"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis
                        dataKey="name"
                        stroke={axisStroke}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke={axisStroke}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) =>
                          v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor:
                            theme === "dark" ? "#1f2937" : "#ffffff",
                          border: `1px solid ${gridStroke}`,
                          borderRadius: "0.5rem",
                          fontSize: 12,
                        }}
                        formatter={(v) => formatCurrency(Number(v))}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Housing" stackId="a" fill="#6366f1" />
                      <Bar
                        dataKey="Transportation"
                        stackId="a"
                        fill="#10b981"
                      />
                      <Bar dataKey="Taxes" stackId="a" fill="#f59e0b" />
                      <Bar
                        dataKey="Living Costs"
                        stackId="a"
                        fill="#ef4444"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {/* ── Verdict ────────────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatTile
                  label="Cheapest"
                  value={comparison.cheapest}
                  subtitle={formatCurrency(
                    comparison.scenarios.find(
                      (s) => s.label === comparison.cheapest
                    )?.total ?? 0
                  )}
                  icon="🏆"
                  variant="success"
                />
                <StatTile
                  label="Most Expensive"
                  value={comparison.mostExpensive}
                  subtitle={formatCurrency(
                    comparison.scenarios.find(
                      (s) => s.label === comparison.mostExpensive
                    )?.total ?? 0
                  )}
                  icon="💸"
                  variant="danger"
                />
                <StatTile
                  label="Annual Spread"
                  value={formatCurrency(comparison.spread)}
                  subtitle={`Over 10 yrs: ${formatCurrency(
                    comparison.spread * 10
                  )}`}
                  icon="📏"
                  variant="warning"
                  liveRegion
                />
              </div>

              {/* ── Detail table ────────────────────────────── */}
              <SectionCard title="Scenario Breakdown">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead className="text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
                      <tr>
                        <th className="text-left py-2 font-medium">
                          Scenario
                        </th>
                        <th className="text-right py-2 font-medium">
                          Housing
                        </th>
                        <th className="text-right py-2 font-medium">
                          Transport
                        </th>
                        <th className="text-right py-2 font-medium">Taxes</th>
                        <th className="text-right py-2 font-medium">
                          Living
                        </th>
                        <th className="text-right py-2 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.scenarios.map((s) => {
                        const isCheapest = s.label === comparison.cheapest;
                        return (
                          <tr
                            key={s.label}
                            className={`border-b border-gray-100/50 dark:border-gray-700/30 ${
                              isCheapest
                                ? "bg-emerald-50/50 dark:bg-emerald-900/10"
                                : ""
                            }`}
                          >
                            <td className="py-3 font-medium text-gray-800 dark:text-gray-100">
                              {s.label}
                              {isCheapest && (
                                <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                                  🏆 Cheapest
                                </span>
                              )}
                            </td>
                            <td className="text-right py-3 text-gray-600 dark:text-gray-300">
                              {formatCurrency(s.housing)}
                            </td>
                            <td className="text-right py-3 text-gray-600 dark:text-gray-300">
                              {formatCurrency(s.transportation)}
                            </td>
                            <td className="text-right py-3 text-gray-600 dark:text-gray-300">
                              {formatCurrency(s.taxes)}
                            </td>
                            <td className="text-right py-3 text-gray-600 dark:text-gray-300">
                              {formatCurrency(s.livingCosts)}
                            </td>
                            <td className="text-right py-3 font-bold text-gray-900 dark:text-gray-100">
                              {formatCurrency(s.total)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          )}

          {state.scenarios.length === 1 && (
            <SectionCard title="Add at least one more scenario">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Add a second scenario to see a side-by-side comparison.
              </p>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
