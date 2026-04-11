"use client";

/**
 * /tools/mortgage/income — Income & federal/state tax inputs.
 *
 * Fills in the income section of the tool state. Also shows:
 *   - Estimated tax savings from itemizing the mortgage
 *   - Whether the user should itemize (itemized > standard)
 *   - Affordability at the 28% rule
 *   - Extra lifestyle tax impacts (home office, business mileage, transit)
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
import {
  calculateTaxSavings,
  calculateAffordability,
  standardDeduction,
} from "@/lib/utils/mortgage-math";
import { calculateLifestyleTaxImpact } from "@/lib/utils/lifestyle-math";
import { US_STATES, getStateByCode } from "@/lib/data/us-states-tax";
import { formatCurrency } from "@/lib/utils/format";

export default function IncomePage() {
  const { state, updateIncome, hydrated } = useMortgageTool();
  const { income, mortgage } = state;

  // When the state code changes, auto-update the rate from the lookup table.
  const handleStateChange = (code: string) => {
    const info = getStateByCode(code);
    updateIncome({
      stateCode: code,
      stateMarginalRate: info?.topRate ?? 0,
    });
  };

  const taxInputs = toTaxInputs(state);
  const mortgageInputs = toMortgageInputs(state);

  const taxSavings = useMemo(
    () => (taxInputs ? calculateTaxSavings(mortgageInputs, taxInputs) : null),
    [mortgageInputs, taxInputs]
  );

  const affordability = useMemo(
    () =>
      calculateAffordability(
        income.annualIncome,
        mortgage.downPayment,
        mortgage.interestRate,
        mortgage.loanTermYears,
        mortgage.propertyTaxRate,
        0.35,
        mortgage.homePrice
      ),
    [
      income.annualIncome,
      mortgage.downPayment,
      mortgage.interestRate,
      mortgage.loanTermYears,
      mortgage.propertyTaxRate,
      mortgage.homePrice,
    ]
  );

  const lifestyleTax = useMemo(
    () =>
      calculateLifestyleTaxImpact({
        annualIncome: income.annualIncome,
        filingStatus: income.filingStatus,
        federalMarginalRate: income.federalMarginalRate,
        stateA: {
          label: income.stateCode || "Current",
          rate: income.stateMarginalRate,
        },
        stateB: {
          label: income.stateCode || "Current",
          rate: income.stateMarginalRate,
        },
        transitMonthly: state.transportation.transit?.monthlyPass ?? 0,
        hasTransitBenefit:
          state.transportation.transit?.preTaxBenefit ?? false,
        businessMiles: income.selfEmployed ? income.businessMiles : 0,
        homeOfficeSqft: income.selfEmployed ? income.homeOfficeSqft : 0,
      }),
    [
      income.annualIncome,
      income.filingStatus,
      income.federalMarginalRate,
      income.stateCode,
      income.stateMarginalRate,
      income.selfEmployed,
      income.businessMiles,
      income.homeOfficeSqft,
      state.transportation.transit,
    ]
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
          title="Household Income"
          description="We use this to estimate tax savings and affordability."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              label="Annual Gross Income"
              prefix="$"
              value={income.annualIncome}
              onChange={(v) => updateIncome({ annualIncome: v })}
              step={1000}
              min={0}
              helperText="Pre-tax household income."
            />
            <FormField
              label="Filing Status"
              type="select"
              value={income.filingStatus}
              onChange={(v) =>
                updateIncome({
                  filingStatus: v as typeof income.filingStatus,
                })
              }
              helperText="Affects the standard deduction."
            >
              <option value="single">Single</option>
              <option value="married_joint">Married, filing jointly</option>
              <option value="head_of_household">Head of household</option>
            </FormField>
            <FormField
              label="Federal Marginal Rate"
              suffix="%"
              value={income.federalMarginalRate}
              onChange={(v) => updateIncome({ federalMarginalRate: v })}
              step={1}
              min={0}
              max={50}
              helperText="Common brackets: 12, 22, 24, 32, 35, 37"
              tooltip="The tax rate on your last dollar of income. This is what tax deductions actually save you."
            />
            <FormField
              label="State"
              type="select"
              value={income.stateCode}
              onChange={handleStateChange}
              helperText="Auto-fills the state tax rate."
            >
              <option value="">— Select state —</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.topRate}%)
                </option>
              ))}
            </FormField>
            <FormField
              label="State Marginal Rate"
              suffix="%"
              value={income.stateMarginalRate}
              onChange={(v) => updateIncome({ stateMarginalRate: v })}
              step={0.1}
              min={0}
              max={15}
              helperText="Top marginal rate — override if needed."
            />
            <FormField
              label="Other Itemized Deductions"
              prefix="$"
              value={income.otherItemizedDeductions}
              onChange={(v) => updateIncome({ otherItemizedDeductions: v })}
              step={100}
              min={0}
              helperText="Charitable gifts, medical expenses, etc."
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Self-Employment Extras"
          description="Unlock extra deductions available only to self-employed filers."
        >
          <div className="space-y-4">
            <FormField
              label="I'm self-employed"
              type="checkbox"
              value={income.selfEmployed}
              onChange={(v) => updateIncome({ selfEmployed: v })}
              helperText="Unlocks business mileage and home office deductions."
            />
            {income.selfEmployed && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Home Office (sqft)"
                  suffix="sqft"
                  value={income.homeOfficeSqft}
                  onChange={(v) => updateIncome({ homeOfficeSqft: v })}
                  step={10}
                  min={0}
                  max={500}
                  helperText="Simplified method: $5/sqft up to 300 sqft ($1,500 max)."
                />
                <FormField
                  label="Business Miles/Year"
                  suffix="mi"
                  value={income.businessMiles}
                  onChange={(v) => updateIncome({ businessMiles: v })}
                  step={100}
                  min={0}
                  helperText="2024 rate: $0.67/mile. Commuting to a regular office does NOT count."
                />
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-5">
        <SectionCard title="Tax Savings" compact>
          {taxSavings ? (
            <div aria-live="polite">
              <SummaryRow
                label="Deductible Interest"
                value={formatCurrency(taxSavings.deductibleInterest)}
                subtle
              />
              <SummaryRow
                label="Deductible SALT"
                value={formatCurrency(taxSavings.deductibleSalt)}
                subtle
                tone={taxSavings.saltCapHit ? "warning" : "default"}
              />
              <SummaryRow
                label="Other Itemized"
                value={formatCurrency(taxSavings.otherDeductions)}
                subtle
              />
              <SummaryRow
                label="Total Itemized"
                value={formatCurrency(taxSavings.totalItemized)}
              />
              <SummaryRow
                label="Standard Deduction"
                value={formatCurrency(
                  standardDeduction(income.filingStatus)
                )}
                subtle
              />
              <SummaryRow
                label="Itemization Benefit"
                value={formatCurrency(taxSavings.itemizationBenefit)}
                tone={taxSavings.shouldItemize ? "success" : "muted"}
              />
              <SummaryRow
                label="Federal Savings"
                value={formatCurrency(taxSavings.annualFederalSavings)}
                subtle
              />
              <SummaryRow
                label="State Savings"
                value={formatCurrency(taxSavings.annualStateSavings)}
                subtle
              />
              <SummaryRow
                label="Total Annual Savings"
                value={formatCurrency(taxSavings.annualTaxSavings)}
                emphasized
                tone={taxSavings.annualTaxSavings > 0 ? "success" : "muted"}
              />
              {taxSavings.saltCapHit && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3 leading-relaxed">
                  ⚠ Your property tax + state income tax exceed the $10,000
                  SALT cap. Only the first $10k is deductible.
                </p>
              )}
              {!taxSavings.shouldItemize && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                  ℹ The standard deduction beats itemizing for you — the
                  mortgage produces no extra federal tax savings at your
                  income level.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Fill in your income to see estimates.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Affordability (28% rule)" compact>
          <div aria-live="polite">
            <StatTile
              label="Max comfortable home price"
              value={formatCurrency(affordability.maxHomePrice)}
              subtitle={`Max monthly: ${formatCurrency(
                affordability.maxMonthlyPayment
              )}`}
              icon="✅"
              variant="success"
            />
            <div className="mt-3">
              <SummaryRow
                label="Your chosen home"
                value={formatCurrency(mortgage.homePrice)}
                subtle
              />
              <SummaryRow
                label="Housing DTI"
                value={`${affordability.housingDti.toFixed(1)}%`}
                tone={
                  affordability.housingDti <= 28
                    ? "success"
                    : affordability.housingDti <= 36
                      ? "warning"
                      : "danger"
                }
              />
              <SummaryRow
                label="Within budget?"
                value={affordability.withinBudget ? "Yes" : "No"}
                tone={affordability.withinBudget ? "success" : "danger"}
                emphasized
              />
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
              The 28% rule: housing costs (PITI) should stay under 28% of
              gross monthly income. Lenders may allow more, but this is the
              traditional safe target.
            </p>
          </div>
        </SectionCard>

        {income.selfEmployed &&
          (lifestyleTax.homeOfficeDeduction > 0 ||
            lifestyleTax.mileageDeduction > 0) && (
            <SectionCard title="Self-Employed Extras" compact>
              <div aria-live="polite">
                <SummaryRow
                  label="Home office"
                  value={formatCurrency(lifestyleTax.homeOfficeDeduction)}
                  tone="success"
                />
                <SummaryRow
                  label="Business mileage"
                  value={formatCurrency(lifestyleTax.mileageDeduction)}
                  tone="success"
                />
                {lifestyleTax.notes.map((note, i) => (
                  <p
                    key={i}
                    className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed"
                  >
                    {note}
                  </p>
                ))}
              </div>
            </SectionCard>
          )}
      </div>
    </div>
  );
}
