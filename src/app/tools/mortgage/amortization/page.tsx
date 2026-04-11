"use client";

/**
 * /tools/mortgage/amortization — Full amortization schedule page.
 *
 * Shows the year-by-year or month-by-month schedule with toggles for
 * extra-principal payments and biweekly acceleration. Highlights PMI drop-off
 * and calculates how much interest is saved vs the vanilla schedule.
 */

import { useMemo, useState } from "react";
import FormField from "@/components/mortgage/FormField";
import SectionCard from "@/components/mortgage/SectionCard";
import StatTile from "@/components/mortgage/StatTile";
import {
  useMortgageTool,
  toMortgageInputs,
} from "@/contexts/MortgageToolContext";
import {
  generateAmortizationSchedule,
  summarize,
} from "@/lib/utils/mortgage-math";
import { formatCurrency } from "@/lib/utils/format";

type Granularity = "year" | "month";

export default function AmortizationPage() {
  const { state, updateMortgage, hydrated } = useMortgageTool();
  const [granularity, setGranularity] = useState<Granularity>("year");

  const schedule = useMemo(
    () => generateAmortizationSchedule(toMortgageInputs(state)),
    [state]
  );
  const summary = useMemo(
    () => summarize(toMortgageInputs(state)),
    [state]
  );

  // Group by year for the year view
  const yearlyRows = useMemo(() => {
    const rows: {
      year: number;
      principal: number;
      interest: number;
      extra: number;
      endBalance: number;
      pmiActive: boolean;
    }[] = [];
    for (let y = 0; y * 12 < schedule.length; y++) {
      const slice = schedule.slice(y * 12, (y + 1) * 12);
      if (slice.length === 0) break;
      const last = slice[slice.length - 1];
      rows.push({
        year: y + 1,
        principal: slice.reduce((s, e) => s + e.principal, 0),
        interest: slice.reduce((s, e) => s + e.interest, 0),
        extra: slice.reduce((s, e) => s + e.extraPrincipal, 0),
        endBalance: last.balance,
        pmiActive: slice.some((e) => e.pmiActive),
      });
    }
    return rows;
  }, [schedule]);

  // When PMI drops off
  const pmiDropoffMonth = useMemo(() => {
    const idx = schedule.findIndex((e) => !e.pmiActive);
    return idx >= 0 ? idx + 1 : null;
  }, [schedule]);

  if (!hydrated) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Summary stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Payoff Time"
          value={`${summary.payoffYears.toFixed(1)} yrs`}
          subtitle={`${summary.payoffMonths} months`}
          icon="⏱️"
          liveRegion
        />
        <StatTile
          label="Total Interest"
          value={formatCurrency(summary.totalInterest)}
          subtitle="Over the life of the loan"
          icon="📈"
          variant="warning"
          liveRegion
        />
        <StatTile
          label="Interest Saved by Extras"
          value={formatCurrency(summary.interestSavedByExtras)}
          subtitle={
            state.mortgage.extraMonthlyPrincipal > 0 || state.mortgage.biweekly
              ? "vs vanilla schedule"
              : "Enable extras below"
          }
          icon="💰"
          variant={
            summary.interestSavedByExtras > 0 ? "success" : "neutral"
          }
          liveRegion
        />
        <StatTile
          label="PMI Drops Off"
          value={
            pmiDropoffMonth
              ? `Month ${pmiDropoffMonth}`
              : schedule[0]?.pmiActive
                ? "Never (term end)"
                : "Never needed"
          }
          subtitle="When LTV ≤ 80%"
          icon="🛡️"
        />
      </div>

      {/* ── Extra principal + biweekly controls ────────────────────── */}
      <SectionCard
        title="Pay Off Faster"
        description="Add extra principal each month or switch to biweekly payments to shorten the loan and save interest."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Extra Principal (mo)"
            prefix="$"
            value={state.mortgage.extraMonthlyPrincipal}
            onChange={(v) => updateMortgage({ extraMonthlyPrincipal: v })}
            step={50}
            min={0}
            helperText="Extra paid toward principal every month."
          />
          <FormField
            label="Biweekly Payments"
            type="checkbox"
            value={state.mortgage.biweekly}
            onChange={(v) => updateMortgage({ biweekly: v })}
            helperText="26 half-payments/yr ≈ 13 monthly payments — typically saves years."
          />
          <div className="flex items-end">
            <div className="w-full">
              <label
                htmlFor="granularity"
                className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5"
              >
                View
              </label>
              <div
                id="granularity"
                role="tablist"
                aria-label="Amortization view"
                className="inline-flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 w-full"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={granularity === "year"}
                  onClick={() => setGranularity("year")}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    granularity === "year"
                      ? "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-300 shadow-sm"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  By Year
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={granularity === "month"}
                  onClick={() => setGranularity("month")}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    granularity === "month"
                      ? "bg-white dark:bg-gray-600 text-indigo-600 dark:text-indigo-300 shadow-sm"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  By Month
                </button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── Schedule table ────────────────────────────────────────── */}
      <SectionCard
        title={
          granularity === "year"
            ? "Yearly Amortization Schedule"
            : "Monthly Amortization Schedule"
        }
        description={
          granularity === "year"
            ? `${yearlyRows.length} years total`
            : `${schedule.length} payments total`
        }
      >
        <div
          className="overflow-x-auto max-h-[600px] overflow-y-auto"
          tabIndex={0}
          role="region"
          aria-label="Amortization schedule table"
        >
          <table className="w-full text-sm min-w-[600px]">
            <thead className="text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-200/50 dark:border-gray-700/50 sticky top-0 bg-white dark:bg-gray-800 z-10">
              <tr>
                <th className="text-left py-2 font-medium">
                  {granularity === "year" ? "Year" : "#"}
                </th>
                <th className="text-right py-2 font-medium">Principal</th>
                <th className="text-right py-2 font-medium">Interest</th>
                {(state.mortgage.extraMonthlyPrincipal > 0 ||
                  state.mortgage.biweekly) && (
                  <th className="text-right py-2 font-medium">Extra</th>
                )}
                <th className="text-right py-2 font-medium">End Balance</th>
                <th className="text-right py-2 font-medium">PMI</th>
              </tr>
            </thead>
            <tbody>
              {granularity === "year"
                ? yearlyRows.map((row) => (
                    <tr
                      key={row.year}
                      className="border-b border-gray-100/50 dark:border-gray-700/30"
                    >
                      <td className="py-2 text-gray-700 dark:text-gray-300 font-medium">
                        {row.year}
                      </td>
                      <td className="text-right py-2 text-gray-600 dark:text-gray-300 font-medium">
                        {formatCurrency(row.principal)}
                      </td>
                      <td className="text-right py-2 text-amber-600 dark:text-amber-400 font-medium">
                        {formatCurrency(row.interest)}
                      </td>
                      {(state.mortgage.extraMonthlyPrincipal > 0 ||
                        state.mortgage.biweekly) && (
                        <td className="text-right py-2 text-emerald-600 dark:text-emerald-400 font-medium">
                          {formatCurrency(row.extra)}
                        </td>
                      )}
                      <td className="text-right py-2 text-gray-800 dark:text-gray-100 font-medium">
                        {formatCurrency(row.endBalance)}
                      </td>
                      <td className="text-right py-2">
                        {row.pmiActive ? (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                : schedule.map((e) => (
                    <tr
                      key={e.paymentNumber}
                      className="border-b border-gray-100/50 dark:border-gray-700/30"
                    >
                      <td className="py-1.5 text-gray-500 dark:text-gray-400 text-[11px]">
                        {e.paymentNumber}
                      </td>
                      <td className="text-right py-1.5 text-gray-600 dark:text-gray-300">
                        {formatCurrency(e.principal)}
                      </td>
                      <td className="text-right py-1.5 text-amber-600 dark:text-amber-400">
                        {formatCurrency(e.interest)}
                      </td>
                      {(state.mortgage.extraMonthlyPrincipal > 0 ||
                        state.mortgage.biweekly) && (
                        <td className="text-right py-1.5 text-emerald-600 dark:text-emerald-400">
                          {e.extraPrincipal > 0
                            ? formatCurrency(e.extraPrincipal)
                            : "—"}
                        </td>
                      )}
                      <td className="text-right py-1.5 text-gray-800 dark:text-gray-100 font-medium">
                        {formatCurrency(e.balance)}
                      </td>
                      <td className="text-right py-1.5">
                        {e.pmiActive ? (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            ✓
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
