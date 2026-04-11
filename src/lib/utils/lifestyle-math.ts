/**
 * Lifestyle math — transportation, location, and cost-of-living utilities
 * used alongside mortgage-math.ts by the /tools/mortgage calculator.
 *
 * All functions are pure and have no dependency on the browser. Tested in
 * src/lib/utils/__tests__/lifestyle-math.test.ts.
 *
 * References:
 *   - 2024 IRS mileage rate: $0.67/mile (business use, self-employed only)
 *   - 2024 Qualified Transportation Fringe Benefit cap: $315/month
 *     (pre-tax transit pass or commuter highway vehicle)
 *   - TCJA (2017) eliminated the unreimbursed employee commuting deduction
 *     for W-2 workers, but it remains for self-employed individuals.
 */

import type { FilingStatus } from "./mortgage-math";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TransportMode =
  | "car"
  | "transit"
  | "rideshare"
  | "mixed"
  | "walk_bike";

export interface CarInputs {
  /** Purchase price of the car in dollars. */
  price: number;
  /** Down payment on the car. Set equal to price for cash purchase. */
  downPayment: number;
  /** Loan term in months. 0 = cash purchase. */
  loanTermMonths: number;
  /** Annual interest rate on the car loan, percent. */
  interestRate: number;
  insuranceAnnual: number;
  /** Average gas price per gallon. */
  gasPrice: number;
  /** Miles per gallon. */
  mpg: number;
  /** Miles driven per year. */
  milesPerYear: number;
  maintenanceAnnual: number;
  parkingMonthly: number;
  registrationAnnual: number;
  /** Annual depreciation rate as a percent. Default 15. */
  depreciationRate?: number;
}

export interface TransitInputs {
  /** Monthly unlimited pass cost. */
  monthlyPass: number;
  /** Any extra rideshare/taxi budget per month (e.g. weekend trips). */
  rideshareMonthly: number;
  /** Whether the employer offers a pre-tax transit benefit. */
  preTaxBenefit: boolean;
}

export interface RideshareInputs {
  /** Average rides per week. */
  ridesPerWeek: number;
  /** Average cost per ride. */
  costPerRide: number;
}

export interface MixedInputs {
  car: CarInputs;
  transit: TransitInputs;
  /** Share of total commutes done by car (0–1). */
  carShare: number;
}

export interface TransportationInputs {
  mode: TransportMode;
  /** Round-trip commute distance in miles (used for car fuel cost). */
  commuteMilesRoundTrip?: number;
  /** Commute days per week. Default 5. */
  commuteDaysPerWeek?: number;
  /** One-way commute time in minutes (for the time-is-money calculation). */
  commuteMinutesOneWay?: number;
  car?: CarInputs;
  transit?: TransitInputs;
  rideshare?: RideshareInputs;
  mixed?: MixedInputs;
}

export interface TransportationCostBreakdown {
  /** Monthly car loan payment (0 if no loan). */
  loanPayment: number;
  /** Fuel cost. */
  fuel: number;
  /** Insurance, maintenance, parking, registration. */
  insurance: number;
  maintenance: number;
  parking: number;
  registration: number;
  /** Depreciation (a real cost that's often forgotten). */
  depreciation: number;
  /** Transit pass cost. */
  transit: number;
  /** Rideshare budget. */
  rideshare: number;
  /** Pre-tax savings from qualified transit benefit (subtracted from total). */
  preTaxSavings: number;
}

export interface TransportationResult {
  monthly: number;
  annual: number;
  perMile: number;
  hoursPerYear: number;
  breakdown: TransportationCostBreakdown;
  /** Optional dollar value of time spent commuting. */
  timeValueAnnual?: number;
}

export interface LocationInputs {
  label: string;
  /** Property tax rate as percent of home value. */
  propertyTaxRate: number;
  /** State marginal income tax rate, percent. */
  stateIncomeTaxRate: number;
  /** Sales tax rate, percent. */
  salesTaxRate: number;
  /**
   * Cost-of-living index where 100 = national average.
   * E.g. NYC ≈ 170, Austin ≈ 115, rural OH ≈ 85.
   */
  costOfLivingIndex: number;
  /** Walkability score, 0–100. Informational. */
  walkability?: number;
  /** Baseline annual spending on groceries/utilities/etc (not housing or transport). */
  baselineAnnualSpending: number;
}

export interface LocationResult {
  label: string;
  /** Total annual cost of living adjustments applied. */
  adjustedAnnualSpending: number;
  /** Effective state income tax on a given income. */
  stateIncomeTax: number;
}

/** IRS 2024 Qualified Transportation Fringe Benefit cap (monthly). */
export const QTFB_MONTHLY_CAP = 315;

// ─────────────────────────────────────────────────────────────────────────────
// Transportation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monthly car loan payment.
 * Returns 0 for zero-balance or zero-term loans.
 */
export function carLoanPayment(car: CarInputs): number {
  const principal = Math.max(0, car.price - car.downPayment);
  if (principal <= 0 || car.loanTermMonths <= 0) return 0;
  const r = car.interestRate / 100 / 12;
  if (r === 0) return principal / car.loanTermMonths;
  const factor = Math.pow(1 + r, car.loanTermMonths);
  return (principal * (r * factor)) / (factor - 1);
}

/** Annual fuel cost for a given vehicle. */
export function annualFuelCost(car: CarInputs): number {
  if (car.mpg <= 0) return 0;
  const gallons = car.milesPerYear / car.mpg;
  return gallons * car.gasPrice;
}

/** First-year straight-line depreciation dollars. */
export function annualDepreciation(car: CarInputs): number {
  const rate = (car.depreciationRate ?? 15) / 100;
  return car.price * rate;
}

function emptyBreakdown(): TransportationCostBreakdown {
  return {
    loanPayment: 0,
    fuel: 0,
    insurance: 0,
    maintenance: 0,
    parking: 0,
    registration: 0,
    depreciation: 0,
    transit: 0,
    rideshare: 0,
    preTaxSavings: 0,
  };
}

function carBreakdown(car: CarInputs): TransportationCostBreakdown {
  const b = emptyBreakdown();
  const loan = carLoanPayment(car);
  b.loanPayment = loan * 12;
  b.fuel = annualFuelCost(car);
  b.insurance = car.insuranceAnnual;
  b.maintenance = car.maintenanceAnnual;
  b.parking = car.parkingMonthly * 12;
  b.registration = car.registrationAnnual;
  b.depreciation = annualDepreciation(car);
  return b;
}

function sumBreakdown(b: TransportationCostBreakdown): number {
  return (
    b.loanPayment +
    b.fuel +
    b.insurance +
    b.maintenance +
    b.parking +
    b.registration +
    b.depreciation +
    b.transit +
    b.rideshare -
    b.preTaxSavings
  );
}

/**
 * Compute monthly + annual transportation cost for any mode.
 * Also returns the per-mile cost and hours/year spent commuting.
 *
 * When `hourlyWage` is provided, the result includes a `timeValueAnnual`
 * that dollarizes commuting time. The caller decides whether to add it
 * to the total — by default it's not included.
 */
export function calculateTransportationCost(
  inputs: TransportationInputs,
  hourlyWage?: number,
  marginalTaxRate?: number
): TransportationResult {
  const breakdown = emptyBreakdown();
  const daysPerWeek = inputs.commuteDaysPerWeek ?? 5;
  const weeksPerYear = 50; // allow 2 weeks off
  const commuteDays = daysPerWeek * weeksPerYear;

  switch (inputs.mode) {
    case "car": {
      if (inputs.car) {
        Object.assign(breakdown, carBreakdown(inputs.car));
      }
      break;
    }
    case "transit": {
      const t = inputs.transit;
      if (t) {
        breakdown.transit = t.monthlyPass * 12;
        breakdown.rideshare = t.rideshareMonthly * 12;
        if (t.preTaxBenefit && marginalTaxRate != null) {
          const eligible = Math.min(t.monthlyPass, QTFB_MONTHLY_CAP);
          breakdown.preTaxSavings = eligible * 12 * (marginalTaxRate / 100);
        }
      }
      break;
    }
    case "rideshare": {
      const r = inputs.rideshare;
      if (r) {
        breakdown.rideshare = r.ridesPerWeek * r.costPerRide * 52;
      }
      break;
    }
    case "mixed": {
      const m = inputs.mixed;
      if (m) {
        const car = carBreakdown(m.car);
        // Scale variable car costs (fuel + maintenance) by car share.
        car.fuel *= m.carShare;
        car.maintenance *= m.carShare;
        Object.assign(breakdown, car);
        breakdown.transit = m.transit.monthlyPass * 12;
        breakdown.rideshare = m.transit.rideshareMonthly * 12;
        if (m.transit.preTaxBenefit && marginalTaxRate != null) {
          const eligible = Math.min(m.transit.monthlyPass, QTFB_MONTHLY_CAP);
          breakdown.preTaxSavings =
            eligible * 12 * (marginalTaxRate / 100);
        }
      }
      break;
    }
    case "walk_bike":
    default:
      // Zero cost — nothing to add.
      break;
  }

  const annual = sumBreakdown(breakdown);

  // Commute distance → per-mile cost
  const miles =
    (inputs.commuteMilesRoundTrip ?? 0) * commuteDays ||
    inputs.car?.milesPerYear ||
    inputs.mixed?.car.milesPerYear ||
    0;
  const perMile = miles > 0 ? annual / miles : 0;

  // Hours per year commuting
  const minutesPerDay = (inputs.commuteMinutesOneWay ?? 0) * 2;
  const hoursPerYear = (minutesPerDay * commuteDays) / 60;

  const result: TransportationResult = {
    monthly: annual / 12,
    annual,
    perMile,
    hoursPerYear,
    breakdown,
  };
  if (hourlyWage != null && hoursPerYear > 0) {
    result.timeValueAnnual = hoursPerYear * hourlyWage;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adjust a baseline annual spending number by a location's cost-of-living index
 * (100 = national average). Also returns the effective state income tax.
 */
export function calculateLocationCost(
  location: LocationInputs,
  annualIncome: number
): LocationResult {
  const multiplier = location.costOfLivingIndex / 100;
  const adjustedAnnualSpending = location.baselineAnnualSpending * multiplier;
  const stateIncomeTax =
    annualIncome * (location.stateIncomeTaxRate / 100);
  return {
    label: location.label,
    adjustedAnnualSpending,
    stateIncomeTax,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario comparison
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenarioTotals {
  label: string;
  housing: number;
  transportation: number;
  taxes: number;
  livingCosts: number;
  total: number;
}

export interface ScenarioComparisonResult {
  scenarios: ScenarioTotals[];
  cheapest: string;
  mostExpensive: string;
  /** Annual savings from choosing the cheapest over the most expensive. */
  spread: number;
}

/**
 * Compare 2+ fully-specified scenarios on their annual total cost.
 * Each scenario is opaque to this function — callers are expected to compute
 * the four cost buckets before passing them in. Returns the cheapest,
 * most expensive, and the spread between them.
 */
export function compareScenarios(
  scenarios: Omit<ScenarioTotals, "total">[]
): ScenarioComparisonResult {
  if (scenarios.length === 0) {
    return { scenarios: [], cheapest: "", mostExpensive: "", spread: 0 };
  }
  const withTotals: ScenarioTotals[] = scenarios.map((s) => ({
    ...s,
    total: s.housing + s.transportation + s.taxes + s.livingCosts,
  }));
  const sorted = [...withTotals].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0];
  const mostExpensive = sorted[sorted.length - 1];
  return {
    scenarios: withTotals,
    cheapest: cheapest.label,
    mostExpensive: mostExpensive.label,
    spread: mostExpensive.total - cheapest.total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifestyle tax impact helper
// ─────────────────────────────────────────────────────────────────────────────

export interface LifestyleTaxImpactInputs {
  annualIncome: number;
  filingStatus: FilingStatus;
  federalMarginalRate: number;
  /** State A (current). */
  stateA: { label: string; rate: number };
  /** State B (hypothetical). */
  stateB: { label: string; rate: number };
  /** Transit pre-tax benefit used (monthly). */
  transitMonthly?: number;
  /** Whether the employer offers the pre-tax transit benefit. */
  hasTransitBenefit?: boolean;
  /** Annual business miles if self-employed. */
  businessMiles?: number;
  /** 2024 IRS business mileage rate. */
  mileageRate?: number;
  /** Home office sqft if claiming simplified home office deduction. */
  homeOfficeSqft?: number;
}

export interface LifestyleTaxImpactResult {
  stateTaxDelta: number;
  transitPreTaxSavings: number;
  mileageDeduction: number;
  homeOfficeDeduction: number;
  totalAnnualSavings: number;
  notes: string[];
}

/**
 * Aggregate miscellaneous lifestyle-related tax savings that aren't captured
 * by calculateTaxSavings() alone.
 *
 * Returns separate line items so the UI can show each one with an
 * explanation and the grand total.
 */
export function calculateLifestyleTaxImpact(
  inputs: LifestyleTaxImpactInputs
): LifestyleTaxImpactResult {
  const notes: string[] = [];

  // State tax delta: moving from A → B
  const stateTaxA = inputs.annualIncome * (inputs.stateA.rate / 100);
  const stateTaxB = inputs.annualIncome * (inputs.stateB.rate / 100);
  const stateTaxDelta = stateTaxA - stateTaxB;
  if (stateTaxDelta !== 0) {
    const dir = stateTaxDelta > 0 ? "saves" : "costs";
    notes.push(
      `Moving from ${inputs.stateA.label} to ${inputs.stateB.label} ${dir} approximately $${Math.abs(
        Math.round(stateTaxDelta)
      ).toLocaleString()}/yr in state income tax.`
    );
  }

  // Pre-tax transit benefit
  let transitPreTaxSavings = 0;
  if (
    inputs.hasTransitBenefit &&
    inputs.transitMonthly &&
    inputs.transitMonthly > 0
  ) {
    const eligible = Math.min(inputs.transitMonthly, QTFB_MONTHLY_CAP);
    transitPreTaxSavings =
      eligible * 12 * (inputs.federalMarginalRate / 100);
    if (inputs.transitMonthly > QTFB_MONTHLY_CAP) {
      notes.push(
        `Transit pass exceeds the $${QTFB_MONTHLY_CAP}/mo pre-tax cap. Only the first $${QTFB_MONTHLY_CAP} is pre-tax.`
      );
    }
  }

  // Business mileage deduction (self-employed only)
  const mileageRate = inputs.mileageRate ?? 0.67;
  const mileageDeduction =
    (inputs.businessMiles ?? 0) *
    mileageRate *
    (inputs.federalMarginalRate / 100);
  if ((inputs.businessMiles ?? 0) > 0) {
    notes.push(
      `Business miles only deductible for self-employed filers. W-2 commuting is not deductible (TCJA).`
    );
  }

  // Simplified home office deduction ($5/sqft up to 300 sqft)
  const sqft = Math.min(inputs.homeOfficeSqft ?? 0, 300);
  const homeOfficeDeduction = sqft * 5 * (inputs.federalMarginalRate / 100);
  if ((inputs.homeOfficeSqft ?? 0) > 300) {
    notes.push(
      `Simplified home office deduction caps at 300 sqft (max $1,500 deduction).`
    );
  }

  return {
    stateTaxDelta,
    transitPreTaxSavings,
    mileageDeduction,
    homeOfficeDeduction,
    totalAnnualSavings:
      Math.max(0, stateTaxDelta) +
      transitPreTaxSavings +
      mileageDeduction +
      homeOfficeDeduction,
    notes,
  };
}
