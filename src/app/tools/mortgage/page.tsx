"use client";

/**
 * /tools/mortgage — Overview (front page)
 *
 * Shows the core mortgage inputs, headline stat tiles, a PITI breakdown, an
 * amortization mini-chart, and rollup cards from every other sub-page. Cards
 * for unconfigured sections link to the relevant sub-page.
 *
 * Every result updates live via useMemo as the user types. The value regions
 * use aria-live="polite" so screen readers announce the new numbers.
 */

import Link from "next/link";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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
import {
  summarize,
  generateAmortizationSchedule,
  calculateTaxSavings,
  calculateRentVsBuy,
} from "@/lib/utils/mortgage-math";
import {
  calculateTransportationCost,
  calculateLocationCost,
} from "@/lib/utils/lifestyle-math";
import { formatCurrency } from "@/lib/utils/format";
import { useTheme } from "@/contexts/ThemeContext";

export default function MortgageOverviewPage() {
  const { state, updateMortgage, reset, hydrated } = useMortgageTool();
  const { theme } = useTheme();

  const mortgage = toMortgageInputs(state);
  const tax = toTaxInputs(state);

  // ── Derive everything from state ──
  const summary = useMemo(() => summarize(mortgage), [mortgage]);
  const schedule = useMemo(
    () => generateAmortizationSchedule(mortgage),
    [mortgage]
  );
  const taxSavings = useMemo(
    () => (tax ? calculateTaxSavings(mortgage, tax) : null),
    [mortgage, tax]
  );
  const rentVsBuy = useMemo(
    () =>
      state.rentVsBuyConfigured
        ? calculateRentVsBuy(mortgage, state.rentVsBuy, tax ?? undefined)
        : null,
    [mortgage, state.rentVsBuy, state.rentVsBuyConfigured, tax]
  );
  const transport = useMemo(
    () =>
      state.transportationConfigured
        ? calculateTransportationCost(
            state.transportation,
            undefined,
            state.incomeConfigured
              ? state.income.federalMarginalRate
              : undefined
          )
        : null,
    [state]
  );
  const locationCost = useMemo(
    () =>
      state.locationConfigured
        ? calculateLocationCost(
            state.location,
            state.incomeConfigured ? state.income.annualIncome : 0
          )
        : null,
    [
      state.locationConfigured,
      state.location,
      state.incomeConfigured,
      state.income.annualIncome,
    ]
  );

  // Sample the schedule for the chart (one point per year) to keep it fast
  const chartData = useMemo(() => {
    const points: { year: number; balance: number; interest: number; principal: number }[] = [];
    for (let i = 0; i < schedule.length; i += 12) {
      const e = schedule[i];
      points.push({
        year: Math.floor(i / 12) + 1,
        balance: Math.round(e.balance),
        interest: Math.round(e.cumulativeInterest),
        principal: Math.round(e.cumulativePrincipal),
      });
    }
    // Always append the final point
    const last = schedule[schedule.length - 1];
    if (last && points[points.length - 1]?.year !== Math.ceil(schedule.length / 12)) {
      points.push({
        year: Math.ceil(schedule.length / 12),
        balance: Math.round(last.balance),
        interest: Math.round(last.cumulativeInterest),
        principal: Math.round(last.cumulativePrincipal),
      });
    }
    return points;
  }, [schedule]);

  const annualLifestyleCost = useMemo(() => {
    const housing = summary.monthlyPITI.total * 12 - (taxSavings?.annualTaxSavings ?? 0);
    const transportCost = transport?.annual ?? 0;
    const locationSpending = locationCost?.adjustedAnnualSpending ?? 0;
    return housing + transportCost + locationSpending;
  }, [summary.monthlyPITI.total, taxSavings, transport, locationCost]);

  const gridStroke = theme === "dark" ? "#374151" : "#e5e7eb";
  const axisStroke = theme === "dark" ? "#6b7280" : "#9ca3af";

  // Guard against SSR mismatch before localStorage has been read
  if (!hydrated) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Zone 1: Headline stats (always visible) ────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Monthly Payment"
          value={formatCurrency(summary.monthlyPITI.total)}
          subtitle="Principal + Interest + Taxes + Ins + PMI + HOA"
          icon="🏠"
          variant="default"
          liveRegion
        />
        <StatTile
          label="Loan Amount"
          value={formatCurrency(summary.loanAmount)}
          subtitle={`${summary.downPaymentPercent.toFixed(1)}% down`}
          icon="💰"
          variant="neutral"
          liveRegion
        />
        <StatTile
          label="Total Interest"
          value={formatCurrency(summary.totalInterest)}
          subtitle={`Over ${summary.payoffYears.toFixed(1)} years`}
          icon="📈"
          variant="warning"
          liveRegion
        />
        <StatTile
          label="Total Paid"
          value={formatCurrency(summary.totalPayments)}
          subtitle="Principal + interest"
          icon="💳"
          variant="default"
          liveRegion
        />
      </div>

      {/* ── Zone 2: Inputs + PITI breakdown side by side ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Inputs */}
        <div className="lg:col-span-2">
          <SectionCard
            title="The Basics"
            description="Change any value — everything updates instantly."
            action={
              <button
                type="button"
                onClick={() => {
                  if (confirm("Reset all mortgage calculator data?")) reset();
                }}
                className="text-[11px] text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-2 py-1"
                aria-label="Reset all mortgage calculator data"
              >
                Reset
              </button>
            }
          >
            <div className="space-y-4">
              <FormField
                label="Home Price"
                prefix="$"
                value={state.mortgage.homePrice}
                onChange={(v) => updateMortgage({ homePrice: v })}
                step={1000}
                min={0}
                helperText="Purchase price of the home."
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Down Payment"
                  prefix="$"
                  value={state.mortgage.downPayment}
                  onChange={(v) => updateMortgage({ downPayment: v })}
                  step={1000}
                  min={0}
                />
                <FormField
                  label="Down %"
                  suffix="%"
                  value={Number(
                    (
                      (state.mortgage.downPayment /
                        Math.max(1, state.mortgage.homePrice)) *
                      100
                    ).toFixed(2)
                  )}
                  onChange={(v) =>
                    updateMortgage({
                      downPayment: Math.round(
                        (v / 100) * state.mortgage.homePrice
                      ),
                    })
                  }
                  step={0.5}
                  min={0}
                  max={100}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Loan Term"
                  suffix="yrs"
                  value={state.mortgage.loanTermYears}
                  onChange={(v) => updateMortgage({ loanTermYears: v })}
                  step={1}
                  min={1}
                  max={40}
                />
                <FormField
                  label="Interest Rate"
                  suffix="%"
                  value={state.mortgage.interestRate}
                  onChange={(v) => updateMortgage({ interestRate: v })}
                  step={0.1}
                  min={0}
                  max={30}
                />
              </div>
            </div>
          </SectionCard>
        </div>

        {/* PITI breakdown */}
        <div className="lg:col-span-3">
          <SectionCard
            title="Monthly Payment Breakdown"
            description="What goes into the monthly check"
          >
            <div aria-live="polite">
              <SummaryRow
                label="Principal & Interest"
                value={formatCurrency(
                  summary.monthlyPITI.principalAndInterest
                )}
              />
              <SummaryRow
                label="Property Taxes"
                value={formatCurrency(summary.monthlyPITI.propertyTax)}
                subtle
              />
              <SummaryRow
                label="Home Insurance"
                value={formatCurrency(summary.monthlyPITI.insurance)}
                subtle
              />
              {summary.monthlyPITI.pmi > 0 && (
                <SummaryRow
                  label="PMI (Mortgage Insurance)"
                  value={formatCurrency(summary.monthlyPITI.pmi)}
                  subtle
                  tone="warning"
                />
              )}
              {summary.monthlyPITI.hoa > 0 && (
                <SummaryRow
                  label="HOA"
                  value={formatCurrency(summary.monthlyPITI.hoa)}
                  subtle
                />
              )}
              <SummaryRow
                label="Total Monthly Payment"
                value={formatCurrency(summary.monthlyPITI.total)}
                emphasized
              />
              <SummaryRow
                label="Upfront Cash Required"
                value={formatCurrency(summary.upfrontCash)}
                subtle
              />
              {taxSavings && taxSavings.annualTaxSavings > 0 && (
                <SummaryRow
                  label="Est. Annual Tax Savings"
                  value={`− ${formatCurrency(taxSavings.annualTaxSavings)}`}
                  tone="success"
                />
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Zone 3: Amortization chart ─────────────────────────────────── */}
      <SectionCard
        title="Loan Balance Over Time"
        description="How your balance decreases and interest adds up"
      >
        <div className="h-64" role="img" aria-label="Amortization chart showing loan balance decreasing over time">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="interestGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="year"
                stroke={axisStroke}
                tick={{ fontSize: 11 }}
                label={{ value: "Year", position: "insideBottom", offset: -4, fontSize: 11, fill: axisStroke }}
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
                  backgroundColor: theme === "dark" ? "#1f2937" : "#ffffff",
                  border: `1px solid ${gridStroke}`,
                  borderRadius: "0.5rem",
                  fontSize: 12,
                }}
                formatter={(value, name) => [
                  formatCurrency(Number(value)),
                  name === "balance"
                    ? "Remaining Balance"
                    : name === "interest"
                      ? "Cumulative Interest"
                      : "Cumulative Principal",
                ]}
                labelFormatter={(l) => `Year ${l}`}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#6366f1"
                fill="url(#balanceGradient)"
                strokeWidth={2}
                name="balance"
              />
              <Area
                type="monotone"
                dataKey="interest"
                stroke="#f59e0b"
                fill="url(#interestGradient)"
                strokeWidth={1.5}
                name="interest"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* ── Zone 4: Rollup cards from sub-pages ─────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">
          Your Full Cost Picture
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Fill in the other sections for a complete cost-of-living estimate.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Income & Tax */}
          <RollupCard
            href="/tools/mortgage/income"
            icon="💵"
            title="Income & Tax"
            configured={state.incomeConfigured}
            summary={
              taxSavings
                ? [
                    { label: "Annual Income", value: formatCurrency(state.income.annualIncome) },
                    {
                      label: "Tax Savings",
                      value: formatCurrency(taxSavings.annualTaxSavings),
                      tone: "success",
                    },
                    {
                      label: "Should Itemize?",
                      value: taxSavings.shouldItemize ? "Yes" : "No",
                      tone: taxSavings.shouldItemize ? "success" : "muted",
                    },
                  ]
                : undefined
            }
          />

          {/* Location */}
          <RollupCard
            href="/tools/mortgage/location"
            icon="📍"
            title="Location"
            configured={state.locationConfigured}
            summary={
              locationCost
                ? [
                    { label: state.location.label, value: `COL ${state.location.costOfLivingIndex}` },
                    {
                      label: "Adj. living costs",
                      value: formatCurrency(locationCost.adjustedAnnualSpending),
                    },
                    {
                      label: "State income tax",
                      value: formatCurrency(locationCost.stateIncomeTax),
                    },
                  ]
                : undefined
            }
          />

          {/* Transportation */}
          <RollupCard
            href="/tools/mortgage/transportation"
            icon="🚗"
            title="Transportation"
            configured={state.transportationConfigured}
            summary={
              transport
                ? [
                    {
                      label: "Mode",
                      value: friendlyMode(state.transportation.mode),
                    },
                    {
                      label: "Monthly",
                      value: formatCurrency(transport.monthly),
                    },
                    {
                      label: "Annual",
                      value: formatCurrency(transport.annual),
                    },
                  ]
                : undefined
            }
          />

          {/* Rent vs Buy */}
          <RollupCard
            href="/tools/mortgage/rent-vs-buy"
            icon="⚖️"
            title="Rent vs Buy"
            configured={state.rentVsBuyConfigured}
            summary={
              rentVsBuy
                ? [
                    {
                      label: "Break-even",
                      value: rentVsBuy.breakEvenYear
                        ? `Year ${rentVsBuy.breakEvenYear}`
                        : "Never",
                      tone: rentVsBuy.breakEvenYear ? "success" : "warning",
                    },
                    {
                      label: "Savings (30yr)",
                      value: formatCurrency(rentVsBuy.savingsFromBuying),
                      tone:
                        rentVsBuy.savingsFromBuying >= 0 ? "success" : "danger",
                    },
                  ]
                : undefined
            }
          />

          {/* Scenarios */}
          <RollupCard
            href="/tools/mortgage/scenarios"
            icon="📊"
            title="Scenario Comparison"
            configured={state.scenariosConfigured}
            summary={
              state.scenarios.length > 0
                ? [
                    { label: "Scenarios", value: String(state.scenarios.length) },
                    {
                      label: "Cheapest",
                      value:
                        [...state.scenarios].sort(
                          (a, b) =>
                            a.housing +
                            a.transportation +
                            a.taxes +
                            a.livingCosts -
                            (b.housing +
                              b.transportation +
                              b.taxes +
                              b.livingCosts)
                        )[0]?.label ?? "—",
                      tone: "success",
                    },
                  ]
                : undefined
            }
          />

          {/* Amortization shortcut */}
          <RollupCard
            href="/tools/mortgage/amortization"
            icon="📅"
            title="Amortization Schedule"
            configured={
              state.mortgage.extraMonthlyPrincipal > 0 || state.mortgage.biweekly
            }
            summary={[
              { label: "Payoff", value: `${summary.payoffYears.toFixed(1)} yrs` },
              {
                label: "Extras",
                value:
                  state.mortgage.extraMonthlyPrincipal > 0
                    ? `+${formatCurrency(state.mortgage.extraMonthlyPrincipal)}/mo`
                    : state.mortgage.biweekly
                      ? "Biweekly"
                      : "None",
                tone: "muted",
              },
              ...(summary.interestSavedByExtras > 0
                ? [
                    {
                      label: "Interest Saved",
                      value: formatCurrency(summary.interestSavedByExtras),
                      tone: "success" as const,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      {/* ── Zone 5: Lifestyle total (only if at least one rollup configured) ── */}
      {(state.incomeConfigured ||
        state.transportationConfigured ||
        state.locationConfigured) && (
        <SectionCard
          title="Estimated Total Annual Cost"
          description="Housing (after tax savings) + transportation + location-adjusted living costs"
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatTile
              label="Housing (net)"
              value={formatCurrency(
                summary.monthlyPITI.total * 12 -
                  (taxSavings?.annualTaxSavings ?? 0)
              )}
              subtitle="PITI − tax savings"
              icon="🏠"
            />
            <StatTile
              label="Transportation"
              value={formatCurrency(transport?.annual ?? 0)}
              subtitle={
                transport
                  ? `${friendlyMode(state.transportation.mode)}`
                  : "Not configured"
              }
              icon="🚗"
              variant={transport ? "default" : "neutral"}
            />
            <StatTile
              label="Living Costs"
              value={formatCurrency(locationCost?.adjustedAnnualSpending ?? 0)}
              subtitle={
                locationCost
                  ? `COL index ${state.location.costOfLivingIndex}`
                  : "Not configured"
              }
              icon="🛒"
              variant={locationCost ? "default" : "neutral"}
            />
            <StatTile
              label="Grand Total"
              value={formatCurrency(annualLifestyleCost)}
              subtitle="Per year, all-in"
              icon="💰"
              variant="success"
              liveRegion
            />
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function friendlyMode(mode: string): string {
  switch (mode) {
    case "car":
      return "Own a car";
    case "transit":
      return "Public transit";
    case "rideshare":
      return "Rideshare";
    case "mixed":
      return "Mixed (car + transit)";
    case "walk_bike":
      return "Walk / bike";
    default:
      return mode;
  }
}

interface RollupCardProps {
  href: string;
  icon: string;
  title: string;
  configured: boolean;
  summary?: { label: string; value: string; tone?: "default" | "success" | "danger" | "warning" | "muted" }[];
}

function RollupCard({ href, icon, title, configured, summary }: RollupCardProps) {
  return (
    <Link
      href={href}
      className="block bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-5 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">
            {icon}
          </span>
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {title}
          </h3>
        </div>
        {configured ? (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
            aria-label="Configured"
          >
            ✓ Configured
          </span>
        ) : (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
            Not set
          </span>
        )}
      </div>
      {summary && summary.length > 0 ? (
        <div className="space-y-1">
          {summary.map((row, i) => (
            <SummaryRow
              key={i}
              label={row.label}
              value={row.value}
              tone={row.tone}
              subtle
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Tap to fill in this section.
        </p>
      )}
      <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-3 group-hover:underline">
        {configured ? "Edit →" : "Configure →"}
      </p>
    </Link>
  );
}
