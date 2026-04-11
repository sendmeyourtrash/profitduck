"use client";

/**
 * /tools/mortgage/rent-vs-buy — Rent vs buy comparison.
 *
 * Shows a year-by-year net cost comparison with a break-even line and a
 * clear "verdict" that explains which option wins over the selected horizon.
 */

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import FormField from "@/components/mortgage/FormField";
import SectionCard from "@/components/mortgage/SectionCard";
import StatTile from "@/components/mortgage/StatTile";
import SummaryRow from "@/components/mortgage/SummaryRow";
import {
  useMortgageTool,
  toMortgageInputs,
  toTaxInputs,
} from "@/contexts/MortgageToolContext";
import { calculateRentVsBuy } from "@/lib/utils/mortgage-math";
import { formatCurrency } from "@/lib/utils/format";
import { useTheme } from "@/contexts/ThemeContext";

export default function RentVsBuyPage() {
  const { state, updateRentVsBuy, hydrated } = useMortgageTool();
  const { theme } = useTheme();
  const { rentVsBuy } = state;

  const result = useMemo(
    () =>
      calculateRentVsBuy(
        toMortgageInputs(state),
        rentVsBuy,
        toTaxInputs(state) ?? undefined
      ),
    [state, rentVsBuy]
  );

  const chartData = useMemo(
    () =>
      result.timeline.map((p) => ({
        year: p.year,
        Buying: Math.round(p.buyingNetCost),
        Renting: Math.round(p.rentingNetCost),
      })),
    [result.timeline]
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

  const verdictTone: "success" | "warning" | "danger" =
    result.savingsFromBuying > 0
      ? "success"
      : result.savingsFromBuying === 0
        ? "warning"
        : "danger";

  return (
    <div className="space-y-5">
      {/* ── Inputs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3">
          <SectionCard
            title="Comparison Assumptions"
            description="Adjust any of these — the chart updates live."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Equivalent Monthly Rent"
                prefix="$"
                value={rentVsBuy.monthlyRent}
                onChange={(v) => updateRentVsBuy({ monthlyRent: v })}
                step={50}
                min={0}
                helperText="A comparable rental to the home you're considering."
              />
              <FormField
                label="Years to Compare"
                suffix="yrs"
                value={rentVsBuy.yearsToCompare}
                onChange={(v) => updateRentVsBuy({ yearsToCompare: v })}
                step={1}
                min={1}
                max={40}
              />
              <FormField
                label="Rent Inflation"
                suffix="%/yr"
                value={rentVsBuy.rentInflation}
                onChange={(v) => updateRentVsBuy({ rentInflation: v })}
                step={0.1}
                min={0}
                max={15}
                helperText="Long-term US avg ≈ 3%."
              />
              <FormField
                label="Home Appreciation"
                suffix="%/yr"
                value={rentVsBuy.homeAppreciation}
                onChange={(v) => updateRentVsBuy({ homeAppreciation: v })}
                step={0.1}
                min={-5}
                max={15}
                helperText="Long-term US avg ≈ 3%."
              />
              <FormField
                label="Investment Return"
                suffix="%/yr"
                value={rentVsBuy.investmentReturn}
                onChange={(v) => updateRentVsBuy({ investmentReturn: v })}
                step={0.1}
                min={0}
                max={20}
                tooltip="If you rented instead, what return could you get on the down payment if invested? S&P 500 long-term ≈ 7% real."
              />
              <FormField
                label="Maintenance"
                suffix="%/yr"
                value={rentVsBuy.maintenancePercent}
                onChange={(v) => updateRentVsBuy({ maintenancePercent: v })}
                step={0.1}
                min={0}
                max={5}
                helperText="Typical rule of thumb: 1% of home value per year."
              />
              <FormField
                label="Selling Costs"
                suffix="%"
                value={rentVsBuy.sellingCostsPercent}
                onChange={(v) =>
                  updateRentVsBuy({ sellingCostsPercent: v })
                }
                step={0.5}
                min={0}
                max={15}
                helperText="Agent commission + closing costs on sale. ≈ 6%."
              />
              <FormField
                label="Renters Insurance (yr)"
                prefix="$"
                value={rentVsBuy.rentersInsuranceAnnual}
                onChange={(v) =>
                  updateRentVsBuy({ rentersInsuranceAnnual: v })
                }
                step={20}
                min={0}
              />
            </div>
          </SectionCard>
        </div>

        {/* ── Verdict stats ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          <StatTile
            label="Break-even year"
            value={
              result.breakEvenYear
                ? `Year ${result.breakEvenYear}`
                : "Never"
            }
            subtitle={
              result.breakEvenYear
                ? "When buying becomes cheaper than renting"
                : "Renting stays ahead over the horizon"
            }
            icon="⚖️"
            variant={result.breakEvenYear ? "success" : "warning"}
            liveRegion
          />
          <StatTile
            label={`Savings after ${rentVsBuy.yearsToCompare} years`}
            value={formatCurrency(Math.abs(result.savingsFromBuying))}
            subtitle={
              result.savingsFromBuying >= 0
                ? "You save this much by buying"
                : "You save this much by renting"
            }
            icon={result.savingsFromBuying >= 0 ? "🏠" : "🔑"}
            variant={verdictTone}
            liveRegion
          />
          <StatTile
            label="Home value at end"
            value={formatCurrency(
              result.timeline[result.timeline.length - 1]?.homeValue ?? 0
            )}
            subtitle={`Grown at ${rentVsBuy.homeAppreciation}%/yr`}
            icon="📈"
          />
        </div>
      </div>

      {/* ── Chart ──────────────────────────────────────────────────── */}
      <SectionCard
        title="Cumulative Net Cost Over Time"
        description="Lower is better. The break-even point is where the lines cross."
      >
        <div
          className="h-80"
          role="img"
          aria-label="Line chart comparing cumulative net cost of buying vs renting over time"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="year"
                stroke={axisStroke}
                tick={{ fontSize: 11 }}
                label={{
                  value: "Year",
                  position: "insideBottom",
                  offset: -4,
                  fontSize: 11,
                  fill: axisStroke,
                }}
              />
              <YAxis
                stroke={axisStroke}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  Math.abs(v) >= 1000
                    ? `$${(v / 1000).toFixed(0)}k`
                    : `$${v}`
                }
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme === "dark" ? "#1f2937" : "#ffffff",
                  border: `1px solid ${gridStroke}`,
                  borderRadius: "0.5rem",
                  fontSize: 12,
                }}
                formatter={(value) => formatCurrency(Number(value))}
                labelFormatter={(l) => `Year ${l}`}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                iconType="line"
              />
              <Line
                type="monotone"
                dataKey="Buying"
                stroke="#6366f1"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Renting"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={false}
              />
              {result.breakEvenYear && (
                <ReferenceLine
                  x={result.breakEvenYear}
                  stroke="#10b981"
                  strokeDasharray="6 3"
                  label={{
                    value: "Break-even",
                    position: "top",
                    fontSize: 10,
                    fill: "#10b981",
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* ── Yearly detail rollup ──────────────────────────────────── */}
      <SectionCard
        title="Year-by-year Detail"
        description="Scroll the table for the full timeline."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50">
              <tr>
                <th className="text-left py-2 font-medium">Year</th>
                <th className="text-right py-2 font-medium">Buying Net</th>
                <th className="text-right py-2 font-medium">Renting Net</th>
                <th className="text-right py-2 font-medium">Home Value</th>
                <th className="text-right py-2 font-medium">Equity</th>
              </tr>
            </thead>
            <tbody>
              {result.timeline.map((p) => {
                const isBreakEven =
                  result.breakEvenYear === p.year;
                const buyingWinsRow = p.buyingNetCost <= p.rentingNetCost;
                return (
                  <tr
                    key={p.year}
                    className={`border-b border-gray-100/50 dark:border-gray-700/30 ${
                      isBreakEven
                        ? "bg-emerald-50/50 dark:bg-emerald-900/10"
                        : ""
                    }`}
                  >
                    <td className="py-2 text-gray-700 dark:text-gray-300">
                      {p.year}
                      {isBreakEven && (
                        <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                          ← break-even
                        </span>
                      )}
                    </td>
                    <td
                      className={`text-right py-2 font-medium ${
                        buyingWinsRow
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {formatCurrency(p.buyingNetCost)}
                    </td>
                    <td
                      className={`text-right py-2 font-medium ${
                        !buyingWinsRow
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {formatCurrency(p.rentingNetCost)}
                    </td>
                    <td className="text-right py-2 text-gray-600 dark:text-gray-400">
                      {formatCurrency(p.homeValue)}
                    </td>
                    <td className="text-right py-2 text-gray-600 dark:text-gray-400">
                      {formatCurrency(p.equity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ── Verdict explanation ───────────────────────────────────── */}
      <SectionCard title="Verdict" compact>
        <div aria-live="polite">
          {result.savingsFromBuying > 0 ? (
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
              Over <strong>{rentVsBuy.yearsToCompare} years</strong>, buying
              saves you approximately{" "}
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(result.savingsFromBuying)}
              </span>{" "}
              compared to renting — mainly through equity accumulation and
              home appreciation at {rentVsBuy.homeAppreciation}%/yr.
              {result.breakEvenYear && (
                <>
                  {" "}
                  Buying becomes the cheaper option starting in{" "}
                  <strong>year {result.breakEvenYear}</strong>.
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
              Over <strong>{rentVsBuy.yearsToCompare} years</strong>, renting
              saves you approximately{" "}
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {formatCurrency(Math.abs(result.savingsFromBuying))}
              </span>{" "}
              compared to buying — the opportunity cost of the down payment
              invested at {rentVsBuy.investmentReturn}% outpaces home
              appreciation after accounting for maintenance, closing, and
              selling costs.
            </p>
          )}
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
            This comparison doesn&apos;t account for intangibles: stability,
            flexibility to move, pride of ownership, landlord risk, etc.
            Use it as one input, not the final answer.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
