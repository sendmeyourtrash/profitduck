"use client";

/**
 * /tools/mortgage/location — Property, state, and cost-of-living inputs.
 *
 * Fills in the location section and shows how it affects property tax,
 * state income tax, SALT cap, and overall cost of living adjustment.
 */

import { useMemo } from "react";
import FormField from "@/components/mortgage/FormField";
import SectionCard from "@/components/mortgage/SectionCard";
import StatTile from "@/components/mortgage/StatTile";
import SummaryRow from "@/components/mortgage/SummaryRow";
import {
  useMortgageTool,
  toMortgageInputs,
  toTaxInputs,
} from "@/contexts/MortgageToolContext";
import { calculateTaxSavings } from "@/lib/utils/mortgage-math";
import { calculateLocationCost } from "@/lib/utils/lifestyle-math";
import { US_STATES, getStateByCode } from "@/lib/data/us-states-tax";
import { formatCurrency } from "@/lib/utils/format";

export default function LocationPage() {
  const { state, updateLocation, updateMortgage, hydrated } = useMortgageTool();
  const { location, income } = state;

  const handleStateQuickApply = (code: string) => {
    const info = getStateByCode(code);
    if (!info) return;
    updateLocation({
      label: info.name,
      propertyTaxRate: info.propertyTaxRate,
      stateIncomeTaxRate: info.topRate,
      salesTaxRate: info.salesTaxRate,
      costOfLivingIndex: info.costOfLivingIndex,
    });
    // Also apply the property tax rate to the mortgage calculation.
    updateMortgage({ propertyTaxRate: info.propertyTaxRate });
  };

  const locationCost = useMemo(
    () =>
      calculateLocationCost(
        location,
        state.incomeConfigured ? income.annualIncome : 0
      ),
    [location, state.incomeConfigured, income.annualIncome]
  );

  const taxInputs = toTaxInputs(state);
  const mortgageInputs = toMortgageInputs(state);
  const taxSavings = useMemo(
    () => (taxInputs ? calculateTaxSavings(mortgageInputs, taxInputs) : null),
    [mortgageInputs, taxInputs]
  );

  if (!hydrated) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* ── Inputs ─────────────────────────────────────────────────── */}
      <div className="lg:col-span-3 space-y-5">
        <SectionCard
          title="Quick State Preset"
          description="Pick a state to auto-fill property tax, state income tax, and cost-of-living."
        >
          <FormField
            label="State"
            type="select"
            value=""
            onChange={handleStateQuickApply}
          >
            <option value="">— Apply a state preset —</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </FormField>
        </SectionCard>

        <SectionCard
          title="Custom Location Inputs"
          description="Override any preset value with your actual city/neighborhood numbers."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              label="Label"
              type="text"
              value={location.label}
              onChange={(v) => updateLocation({ label: v })}
              helperText="e.g. 'Downtown Austin' or 'Suburban NJ'"
            />
            <FormField
              label="Property Tax Rate"
              suffix="%"
              value={location.propertyTaxRate}
              onChange={(v) => {
                updateLocation({ propertyTaxRate: v });
                updateMortgage({ propertyTaxRate: v });
              }}
              step={0.05}
              min={0}
              max={5}
              helperText="US national avg ≈ 1.1%. NJ/IL ≈ 2%+."
            />
            <FormField
              label="State Income Tax Rate"
              suffix="%"
              value={location.stateIncomeTaxRate}
              onChange={(v) => updateLocation({ stateIncomeTaxRate: v })}
              step={0.1}
              min={0}
              max={15}
              helperText="Top marginal rate. FL/TX/WA = 0%."
            />
            <FormField
              label="Sales Tax Rate"
              suffix="%"
              value={location.salesTaxRate}
              onChange={(v) => updateLocation({ salesTaxRate: v })}
              step={0.1}
              min={0}
              max={15}
              helperText="Combined state + local."
            />
            <FormField
              label="Cost of Living Index"
              value={location.costOfLivingIndex}
              onChange={(v) => updateLocation({ costOfLivingIndex: v })}
              step={1}
              min={50}
              max={250}
              helperText="100 = US avg. NYC ≈ 170, Austin ≈ 115, rural ≈ 85."
              tooltip="Scales your baseline annual spending (groceries, utilities, services) by this percentage."
            />
            <FormField
              label="Walkability"
              suffix="/100"
              value={location.walkability ?? 50}
              onChange={(v) => updateLocation({ walkability: v })}
              step={5}
              min={0}
              max={100}
              helperText="Informational — how car-dependent is the area?"
            />
            <div className="md:col-span-2">
              <FormField
                label="Baseline Annual Spending (non-housing, non-transport)"
                prefix="$"
                value={location.baselineAnnualSpending}
                onChange={(v) =>
                  updateLocation({ baselineAnnualSpending: v })
                }
                step={500}
                min={0}
                helperText="Groceries, utilities, entertainment, services. We'll scale this by the COL index."
              />
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-5">
        <SectionCard title="Location Impact" compact>
          <div aria-live="polite" className="space-y-3">
            <StatTile
              label={location.label}
              value={formatCurrency(locationCost.adjustedAnnualSpending)}
              subtitle={`Living costs adjusted by COL index ${location.costOfLivingIndex}`}
              icon="📍"
              variant="default"
            />
            {state.incomeConfigured && (
              <StatTile
                label="Annual State Income Tax"
                value={formatCurrency(locationCost.stateIncomeTax)}
                subtitle={`${location.stateIncomeTaxRate}% × ${formatCurrency(income.annualIncome)}`}
                icon="💵"
                variant="warning"
              />
            )}
            <StatTile
              label="Annual Property Tax"
              value={formatCurrency(
                (state.mortgage.homePrice * location.propertyTaxRate) / 100
              )}
              subtitle={`${location.propertyTaxRate}% of home value`}
              icon="🏡"
            />
          </div>
        </SectionCard>

        {taxSavings && taxSavings.saltCapHit && (
          <SectionCard title="SALT Cap Warning" compact>
            <p className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
              Property tax + state income tax exceed the $10,000 SALT cap.
              Only the first $10,000 is federally deductible — the rest has
              no federal tax benefit.
            </p>
            <div className="mt-3">
              <SummaryRow
                label="Combined SALT"
                value={formatCurrency(
                  taxSavings.deductibleSalt > 0
                    ? taxSavings.deductibleSalt +
                        ((state.mortgage.homePrice *
                          location.propertyTaxRate) /
                          100 +
                          locationCost.stateIncomeTax -
                          taxSavings.deductibleSalt)
                    : 0
                )}
              />
              <SummaryRow
                label="Cap applied"
                value={formatCurrency(taxSavings.deductibleSalt)}
                tone="warning"
                emphasized
              />
            </div>
          </SectionCard>
        )}

        <SectionCard title="Walkability" compact>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Score
              </span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {location.walkability ?? 50}/100
              </span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${location.walkability ?? 50}%` }}
                role="progressbar"
                aria-valuenow={location.walkability ?? 50}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Walkability score"
              />
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              {(location.walkability ?? 50) >= 70
                ? "Very walkable — you might not need a car."
                : (location.walkability ?? 50) >= 50
                  ? "Somewhat walkable — a car helps for errands."
                  : "Car-dependent — plan for full transportation costs."}
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
