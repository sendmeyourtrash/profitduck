"use client";

/**
 * /tools/mortgage/transportation — Transportation mode + inputs.
 *
 * Supports car, transit, rideshare, mixed, and walk/bike modes. Each mode
 * reveals the relevant inputs. Results show monthly + annual cost, cost per
 * mile, hours per year commuting, and optional "time is money" dollar value.
 */

import { useMemo, useState } from "react";
import FormField from "@/components/mortgage/FormField";
import SectionCard from "@/components/mortgage/SectionCard";
import StatTile from "@/components/mortgage/StatTile";
import SummaryRow from "@/components/mortgage/SummaryRow";
import { useMortgageTool } from "@/contexts/MortgageToolContext";
import {
  calculateTransportationCost,
  type TransportMode,
} from "@/lib/utils/lifestyle-math";
import { formatCurrency } from "@/lib/utils/format";

const MODE_OPTIONS: { value: TransportMode; label: string; description: string; icon: string }[] = [
  {
    value: "car",
    label: "Own a Car",
    description: "Loan payment, insurance, gas, maintenance, parking, depreciation",
    icon: "🚗",
  },
  {
    value: "transit",
    label: "Public Transit",
    description: "Monthly pass + occasional rideshare for edge cases",
    icon: "🚇",
  },
  {
    value: "rideshare",
    label: "Rideshare Only",
    description: "No car, no transit pass — Uber/Lyft for everything",
    icon: "🚕",
  },
  {
    value: "mixed",
    label: "Car + Transit",
    description: "Keep a car but use transit for commuting",
    icon: "🚇🚗",
  },
  {
    value: "walk_bike",
    label: "Walk / Bike",
    description: "Zero transportation cost",
    icon: "🚴",
  },
];

export default function TransportationPage() {
  const { state, updateTransportation, hydrated } = useMortgageTool();
  const { transportation, income } = state;
  const [timeIsMoney, setTimeIsMoney] = useState(false);

  // Hourly wage derived from income, used for time-is-money toggle
  const hourlyWage = income.annualIncome > 0 ? income.annualIncome / 2080 : 0;

  const result = useMemo(
    () =>
      calculateTransportationCost(
        transportation,
        timeIsMoney && hourlyWage > 0 ? hourlyWage : undefined,
        state.incomeConfigured ? income.federalMarginalRate : undefined
      ),
    [
      transportation,
      timeIsMoney,
      hourlyWage,
      state.incomeConfigured,
      income.federalMarginalRate,
    ]
  );

  const totalWithTime =
    result.annual + (timeIsMoney ? (result.timeValueAnnual ?? 0) : 0);

  if (!hydrated) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Mode selector ───────────────────────────────────────────── */}
      <SectionCard title="Pick a Transportation Mode">
        <fieldset>
          <legend className="sr-only">Transportation mode</legend>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {MODE_OPTIONS.map((option) => {
              const isSelected = transportation.mode === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-indigo-500 ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="transport-mode"
                    value={option.value}
                    checked={isSelected}
                    onChange={() =>
                      updateTransportation({ mode: option.value })
                    }
                    className="sr-only"
                  />
                  <span className="text-2xl" aria-hidden="true">
                    {option.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {option.label}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
                      {option.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </fieldset>
      </SectionCard>

      {/* ── Commute details (always visible) ────────────────────────── */}
      <SectionCard title="Commute Details">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Round-trip distance"
            suffix="mi"
            value={transportation.commuteMilesRoundTrip ?? 0}
            onChange={(v) =>
              updateTransportation({ commuteMilesRoundTrip: v })
            }
            step={1}
            min={0}
          />
          <FormField
            label="Days per week"
            value={transportation.commuteDaysPerWeek ?? 5}
            onChange={(v) =>
              updateTransportation({ commuteDaysPerWeek: v })
            }
            step={1}
            min={0}
            max={7}
          />
          <FormField
            label="One-way time"
            suffix="min"
            value={transportation.commuteMinutesOneWay ?? 0}
            onChange={(v) =>
              updateTransportation({ commuteMinutesOneWay: v })
            }
            step={5}
            min={0}
          />
        </div>
      </SectionCard>

      {/* ── Mode-specific inputs ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-5">
          {(transportation.mode === "car" ||
            transportation.mode === "mixed") && (
            <SectionCard title="Car Details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Purchase Price"
                  prefix="$"
                  value={
                    transportation.mode === "mixed"
                      ? transportation.mixed?.car.price ?? 0
                      : transportation.car?.price ?? 0
                  }
                  onChange={(v) => {
                    if (transportation.mode === "mixed" && transportation.mixed) {
                      updateTransportation({
                        mixed: {
                          ...transportation.mixed,
                          car: { ...transportation.mixed.car, price: v },
                        },
                      });
                    } else if (transportation.car) {
                      updateTransportation({
                        car: { ...transportation.car, price: v },
                      });
                    }
                  }}
                  step={500}
                  min={0}
                />
                <FormField
                  label="Down Payment"
                  prefix="$"
                  value={transportation.car?.downPayment ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, downPayment: v },
                    })
                  }
                  step={500}
                  min={0}
                />
                <FormField
                  label="Loan Term"
                  suffix="mo"
                  value={transportation.car?.loanTermMonths ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, loanTermMonths: v },
                    })
                  }
                  step={12}
                  min={0}
                  max={96}
                />
                <FormField
                  label="Interest Rate"
                  suffix="%"
                  value={transportation.car?.interestRate ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, interestRate: v },
                    })
                  }
                  step={0.1}
                  min={0}
                  max={30}
                />
                <FormField
                  label="Insurance (yr)"
                  prefix="$"
                  value={transportation.car?.insuranceAnnual ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, insuranceAnnual: v },
                    })
                  }
                  step={100}
                  min={0}
                />
                <FormField
                  label="MPG"
                  value={transportation.car?.mpg ?? 28}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, mpg: v },
                    })
                  }
                  step={1}
                  min={1}
                />
                <FormField
                  label="Gas Price"
                  prefix="$"
                  suffix="/gal"
                  value={transportation.car?.gasPrice ?? 3.5}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, gasPrice: v },
                    })
                  }
                  step={0.1}
                  min={0}
                />
                <FormField
                  label="Miles per Year"
                  suffix="mi"
                  value={transportation.car?.milesPerYear ?? 12000}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, milesPerYear: v },
                    })
                  }
                  step={1000}
                  min={0}
                />
                <FormField
                  label="Maintenance (yr)"
                  prefix="$"
                  value={transportation.car?.maintenanceAnnual ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, maintenanceAnnual: v },
                    })
                  }
                  step={100}
                  min={0}
                />
                <FormField
                  label="Parking (mo)"
                  prefix="$"
                  value={transportation.car?.parkingMonthly ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, parkingMonthly: v },
                    })
                  }
                  step={10}
                  min={0}
                />
                <FormField
                  label="Registration (yr)"
                  prefix="$"
                  value={transportation.car?.registrationAnnual ?? 0}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, registrationAnnual: v },
                    })
                  }
                  step={10}
                  min={0}
                />
                <FormField
                  label="Depreciation"
                  suffix="%/yr"
                  value={transportation.car?.depreciationRate ?? 15}
                  onChange={(v) =>
                    transportation.car &&
                    updateTransportation({
                      car: { ...transportation.car, depreciationRate: v },
                    })
                  }
                  step={1}
                  min={0}
                  max={50}
                  helperText="A real cost people forget to include."
                />
              </div>
            </SectionCard>
          )}

          {(transportation.mode === "transit" ||
            transportation.mode === "mixed") && (
            <SectionCard title="Transit Details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Monthly Pass"
                  prefix="$"
                  value={transportation.transit?.monthlyPass ?? 0}
                  onChange={(v) =>
                    transportation.transit &&
                    updateTransportation({
                      transit: { ...transportation.transit, monthlyPass: v },
                    })
                  }
                  step={5}
                  min={0}
                  helperText="NYC MetroCard $132, Boston T $90, DC $81"
                />
                <FormField
                  label="Rideshare budget (mo)"
                  prefix="$"
                  value={transportation.transit?.rideshareMonthly ?? 0}
                  onChange={(v) =>
                    transportation.transit &&
                    updateTransportation({
                      transit: {
                        ...transportation.transit,
                        rideshareMonthly: v,
                      },
                    })
                  }
                  step={10}
                  min={0}
                  helperText="Occasional Uber/Lyft when transit doesn't work."
                />
                <div className="md:col-span-2">
                  <FormField
                    label="My employer offers pre-tax transit benefit (QTFB)"
                    type="checkbox"
                    value={transportation.transit?.preTaxBenefit ?? false}
                    onChange={(v) =>
                      transportation.transit &&
                      updateTransportation({
                        transit: {
                          ...transportation.transit,
                          preTaxBenefit: v,
                        },
                      })
                    }
                    helperText="IRS allows up to $315/mo of transit pass costs to be deducted pre-tax."
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {transportation.mode === "rideshare" && (
            <SectionCard title="Rideshare Details">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Rides per week"
                  value={transportation.rideshare?.ridesPerWeek ?? 0}
                  onChange={(v) =>
                    transportation.rideshare &&
                    updateTransportation({
                      rideshare: {
                        ...transportation.rideshare,
                        ridesPerWeek: v,
                      },
                    })
                  }
                  step={1}
                  min={0}
                />
                <FormField
                  label="Avg cost per ride"
                  prefix="$"
                  value={transportation.rideshare?.costPerRide ?? 0}
                  onChange={(v) =>
                    transportation.rideshare &&
                    updateTransportation({
                      rideshare: {
                        ...transportation.rideshare,
                        costPerRide: v,
                      },
                    })
                  }
                  step={0.5}
                  min={0}
                />
              </div>
            </SectionCard>
          )}

          {transportation.mode === "walk_bike" && (
            <SectionCard title="Walk / Bike">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Congrats — this is the cheapest option. No inputs needed.
                Your only "cost" is time, which you can toggle on below.
              </p>
            </SectionCard>
          )}
        </div>

        {/* ── Results ───────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          <SectionCard title="Monthly Cost" compact>
            <StatTile
              label="Annual"
              value={formatCurrency(result.annual)}
              subtitle={`${formatCurrency(result.monthly)}/mo`}
              icon="💸"
              variant="default"
              liveRegion
            />
            <div className="mt-3 space-y-1">
              {result.breakdown.loanPayment > 0 && (
                <SummaryRow
                  label="Car loan"
                  value={formatCurrency(result.breakdown.loanPayment)}
                  subtle
                />
              )}
              {result.breakdown.fuel > 0 && (
                <SummaryRow
                  label="Fuel"
                  value={formatCurrency(result.breakdown.fuel)}
                  subtle
                />
              )}
              {result.breakdown.insurance > 0 && (
                <SummaryRow
                  label="Insurance"
                  value={formatCurrency(result.breakdown.insurance)}
                  subtle
                />
              )}
              {result.breakdown.maintenance > 0 && (
                <SummaryRow
                  label="Maintenance"
                  value={formatCurrency(result.breakdown.maintenance)}
                  subtle
                />
              )}
              {result.breakdown.parking > 0 && (
                <SummaryRow
                  label="Parking"
                  value={formatCurrency(result.breakdown.parking)}
                  subtle
                />
              )}
              {result.breakdown.registration > 0 && (
                <SummaryRow
                  label="Registration"
                  value={formatCurrency(result.breakdown.registration)}
                  subtle
                />
              )}
              {result.breakdown.depreciation > 0 && (
                <SummaryRow
                  label="Depreciation"
                  value={formatCurrency(result.breakdown.depreciation)}
                  subtle
                />
              )}
              {result.breakdown.transit > 0 && (
                <SummaryRow
                  label="Transit pass"
                  value={formatCurrency(result.breakdown.transit)}
                  subtle
                />
              )}
              {result.breakdown.rideshare > 0 && (
                <SummaryRow
                  label="Rideshare"
                  value={formatCurrency(result.breakdown.rideshare)}
                  subtle
                />
              )}
              {result.breakdown.preTaxSavings > 0 && (
                <SummaryRow
                  label="Pre-tax savings"
                  value={`− ${formatCurrency(result.breakdown.preTaxSavings)}`}
                  tone="success"
                />
              )}
            </div>
          </SectionCard>

          <SectionCard title="Time Cost" compact>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {result.hoursPerYear.toFixed(0)} hrs/year commuting
              </span>
            </div>
            {state.incomeConfigured && hourlyWage > 0 && (
              <div>
                <FormField
                  label={`Treat time as money (${formatCurrency(hourlyWage)}/hr)`}
                  type="checkbox"
                  value={timeIsMoney}
                  onChange={setTimeIsMoney}
                  helperText="Adds hourly wage × commuting hours to the total."
                />
                {timeIsMoney && result.timeValueAnnual && (
                  <div className="mt-3">
                    <SummaryRow
                      label="Time value"
                      value={formatCurrency(result.timeValueAnnual)}
                      tone="warning"
                    />
                    <SummaryRow
                      label="Total with time"
                      value={formatCurrency(totalWithTime)}
                      emphasized
                    />
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {result.perMile > 0 && (
            <SectionCard title="Cost per Mile" compact>
              <StatTile
                label="Per mile"
                value={`$${result.perMile.toFixed(2)}`}
                subtitle="All-in including depreciation"
                icon="📏"
                variant="neutral"
              />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
