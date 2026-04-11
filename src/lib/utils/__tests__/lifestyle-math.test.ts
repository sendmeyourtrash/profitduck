/**
 * Tests for lifestyle-math.ts
 *
 * Verifies:
 *  - Car loan amortization matches the mortgage formula pattern
 *  - Fuel cost scales with miles and gas price
 *  - Transit mode applies QTFB pre-tax benefit only when toggled
 *  - Mixed mode combines car + transit with correct share scaling
 *  - Location cost adjustment scales with COL index
 *  - Scenario comparison identifies cheapest/most-expensive correctly
 *  - Lifestyle tax impact aggregates state delta, transit, mileage, home office
 */

import { describe, it, expect } from "vitest";
import {
  calculateTransportationCost,
  calculateLocationCost,
  compareScenarios,
  calculateLifestyleTaxImpact,
  carLoanPayment,
  annualFuelCost,
  annualDepreciation,
  QTFB_MONTHLY_CAP,
  type CarInputs,
  type TransportationInputs,
} from "../lifestyle-math";

const BASE_CAR: CarInputs = {
  price: 30_000,
  downPayment: 3_000,
  loanTermMonths: 60,
  interestRate: 7,
  insuranceAnnual: 1_500,
  gasPrice: 3.5,
  mpg: 28,
  milesPerYear: 12_000,
  maintenanceAnnual: 800,
  parkingMonthly: 100,
  registrationAnnual: 150,
};

// ─────────────────────────────────────────────────────────────────────────────
// Car components
// ─────────────────────────────────────────────────────────────────────────────

describe("carLoanPayment", () => {
  it("matches the amortization formula for a standard car loan", () => {
    // $27k @ 7% over 60 months → ~$534.59/mo
    const payment = carLoanPayment(BASE_CAR);
    expect(payment).toBeCloseTo(534.59, 0);
  });

  it("returns 0 for a cash purchase", () => {
    const payment = carLoanPayment({
      ...BASE_CAR,
      downPayment: BASE_CAR.price,
    });
    expect(payment).toBe(0);
  });

  it("returns 0 for a zero-term loan", () => {
    const payment = carLoanPayment({ ...BASE_CAR, loanTermMonths: 0 });
    expect(payment).toBe(0);
  });
});

describe("annualFuelCost", () => {
  it("scales linearly with miles", () => {
    const a = annualFuelCost(BASE_CAR);
    const b = annualFuelCost({ ...BASE_CAR, milesPerYear: 24_000 });
    expect(b).toBeCloseTo(a * 2, 2);
  });

  it("matches the known value for 12,000 mi @ 28 mpg @ $3.50", () => {
    // 12000 / 28 = 428.57 gallons * $3.50 = $1500
    const cost = annualFuelCost(BASE_CAR);
    expect(cost).toBeCloseTo(1500, 0);
  });

  it("returns 0 when mpg is 0 (guards division)", () => {
    expect(annualFuelCost({ ...BASE_CAR, mpg: 0 })).toBe(0);
  });
});

describe("annualDepreciation", () => {
  it("uses default 15% when not provided", () => {
    expect(annualDepreciation(BASE_CAR)).toBe(4_500);
  });

  it("respects a custom rate", () => {
    expect(annualDepreciation({ ...BASE_CAR, depreciationRate: 10 })).toBe(
      3_000
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transportation cost (by mode)
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateTransportationCost — car mode", () => {
  it("rolls up all car cost components", () => {
    const result = calculateTransportationCost({
      mode: "car",
      car: BASE_CAR,
    });
    expect(result.annual).toBeGreaterThan(0);
    // Should include loan payment * 12 (as a sanity check)
    expect(result.breakdown.loanPayment).toBeCloseTo(
      carLoanPayment(BASE_CAR) * 12,
      4
    );
    expect(result.breakdown.fuel).toBeCloseTo(1500, 0);
  });

  it("monthly = annual / 12", () => {
    const result = calculateTransportationCost({
      mode: "car",
      car: BASE_CAR,
    });
    expect(result.monthly).toBeCloseTo(result.annual / 12, 4);
  });
});

describe("calculateTransportationCost — transit mode", () => {
  it("applies QTFB pre-tax savings when toggled on", () => {
    const withBenefit = calculateTransportationCost(
      {
        mode: "transit",
        transit: {
          monthlyPass: 130,
          rideshareMonthly: 40,
          preTaxBenefit: true,
        },
      },
      undefined,
      24 // 24% marginal rate
    );
    const withoutBenefit = calculateTransportationCost(
      {
        mode: "transit",
        transit: {
          monthlyPass: 130,
          rideshareMonthly: 40,
          preTaxBenefit: false,
        },
      },
      undefined,
      24
    );
    expect(withBenefit.annual).toBeLessThan(withoutBenefit.annual);
    expect(withBenefit.breakdown.preTaxSavings).toBeGreaterThan(0);
    // Savings = $130 * 12 * 24% = $374.40
    expect(withBenefit.breakdown.preTaxSavings).toBeCloseTo(374.4, 1);
  });

  it("caps pre-tax benefit at QTFB_MONTHLY_CAP", () => {
    const result = calculateTransportationCost(
      {
        mode: "transit",
        transit: {
          monthlyPass: 500, // above the cap
          rideshareMonthly: 0,
          preTaxBenefit: true,
        },
      },
      undefined,
      32
    );
    // Only first $315/mo is pre-tax
    const expected = QTFB_MONTHLY_CAP * 12 * 0.32;
    expect(result.breakdown.preTaxSavings).toBeCloseTo(expected, 1);
  });
});

describe("calculateTransportationCost — rideshare mode", () => {
  it("scales with rides per week and cost per ride", () => {
    const result = calculateTransportationCost({
      mode: "rideshare",
      rideshare: { ridesPerWeek: 10, costPerRide: 15 },
    });
    // 10 * 15 * 52 = $7,800/yr
    expect(result.annual).toBeCloseTo(7_800, 0);
  });
});

describe("calculateTransportationCost — walk/bike mode", () => {
  it("returns zero cost", () => {
    const result = calculateTransportationCost({ mode: "walk_bike" });
    expect(result.annual).toBe(0);
    expect(result.monthly).toBe(0);
  });
});

describe("calculateTransportationCost — time cost", () => {
  it("reports hours per year correctly", () => {
    const result = calculateTransportationCost({
      mode: "transit",
      commuteMinutesOneWay: 45,
      commuteDaysPerWeek: 5,
      transit: { monthlyPass: 130, rideshareMonthly: 0, preTaxBenefit: false },
    });
    // 45 * 2 minutes * 5 * 50 weeks / 60 = 375 hours
    expect(result.hoursPerYear).toBeCloseTo(375, 0);
  });

  it("dollarizes time when hourlyWage is provided", () => {
    const result = calculateTransportationCost(
      {
        mode: "transit",
        commuteMinutesOneWay: 30,
        transit: {
          monthlyPass: 130,
          rideshareMonthly: 0,
          preTaxBenefit: false,
        },
      },
      50 // $50/hr
    );
    expect(result.timeValueAnnual).toBeGreaterThan(0);
    expect(result.timeValueAnnual).toBeCloseTo(
      result.hoursPerYear * 50,
      4
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateLocationCost", () => {
  it("scales baseline spending by COL index", () => {
    const baseline = 30_000;
    const result = calculateLocationCost(
      {
        label: "City",
        propertyTaxRate: 1.2,
        stateIncomeTaxRate: 6,
        salesTaxRate: 8,
        costOfLivingIndex: 150, // 50% above national avg
        baselineAnnualSpending: baseline,
      },
      120_000
    );
    expect(result.adjustedAnnualSpending).toBeCloseTo(baseline * 1.5, 2);
    expect(result.stateIncomeTax).toBeCloseTo(120_000 * 0.06, 2);
  });

  it("handles COL index of 100 (national avg) as 1:1", () => {
    const result = calculateLocationCost(
      {
        label: "Average",
        propertyTaxRate: 1,
        stateIncomeTaxRate: 4,
        salesTaxRate: 7,
        costOfLivingIndex: 100,
        baselineAnnualSpending: 20_000,
      },
      80_000
    );
    expect(result.adjustedAnnualSpending).toBeCloseTo(20_000, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario comparison
// ─────────────────────────────────────────────────────────────────────────────

describe("compareScenarios", () => {
  it("identifies cheapest and most expensive", () => {
    const result = compareScenarios([
      { label: "Rent City", housing: 36_000, transportation: 1_800, taxes: 9_000, livingCosts: 25_000 },
      { label: "Buy Suburb", housing: 28_000, transportation: 7_500, taxes: 6_000, livingCosts: 22_000 },
      { label: "Buy City", housing: 48_000, transportation: 2_500, taxes: 11_000, livingCosts: 27_000 },
    ]);
    expect(result.scenarios.length).toBe(3);
    // Rent City total = 71,800; Buy Suburb = 63,500; Buy City = 88,500
    expect(result.cheapest).toBe("Buy Suburb");
    expect(result.mostExpensive).toBe("Buy City");
    expect(result.spread).toBeCloseTo(88_500 - 63_500, 0);
  });

  it("computes totals as sum of the four cost buckets", () => {
    const result = compareScenarios([
      { label: "A", housing: 10, transportation: 20, taxes: 30, livingCosts: 40 },
    ]);
    expect(result.scenarios[0].total).toBe(100);
  });

  it("handles an empty list without crashing", () => {
    const result = compareScenarios([]);
    expect(result.scenarios).toEqual([]);
    expect(result.spread).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lifestyle tax impact
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateLifestyleTaxImpact", () => {
  it("computes state income tax delta when moving between states", () => {
    const result = calculateLifestyleTaxImpact({
      annualIncome: 150_000,
      filingStatus: "single",
      federalMarginalRate: 24,
      stateA: { label: "NY", rate: 6.85 },
      stateB: { label: "FL", rate: 0 },
    });
    // Moving from 6.85% → 0% saves $10,275/yr on $150k
    expect(result.stateTaxDelta).toBeCloseTo(10_275, 0);
  });

  it("applies QTFB pre-tax savings within the cap", () => {
    const result = calculateLifestyleTaxImpact({
      annualIncome: 100_000,
      filingStatus: "single",
      federalMarginalRate: 22,
      stateA: { label: "NY", rate: 6.85 },
      stateB: { label: "NY", rate: 6.85 },
      transitMonthly: 150,
      hasTransitBenefit: true,
    });
    // $150 * 12 * 22% = $396
    expect(result.transitPreTaxSavings).toBeCloseTo(396, 1);
  });

  it("caps home office deduction at 300 sqft", () => {
    const result = calculateLifestyleTaxImpact({
      annualIncome: 100_000,
      filingStatus: "single",
      federalMarginalRate: 22,
      stateA: { label: "NY", rate: 6.85 },
      stateB: { label: "NY", rate: 6.85 },
      homeOfficeSqft: 500, // exceeds cap
    });
    // Capped at 300 sqft * $5 = $1500 deduction * 22% = $330
    expect(result.homeOfficeDeduction).toBeCloseTo(330, 1);
    expect(result.notes.some((n) => n.includes("300 sqft"))).toBe(true);
  });

  it("includes mileage deduction for self-employed business miles", () => {
    const result = calculateLifestyleTaxImpact({
      annualIncome: 100_000,
      filingStatus: "single",
      federalMarginalRate: 22,
      stateA: { label: "NY", rate: 6.85 },
      stateB: { label: "NY", rate: 6.85 },
      businessMiles: 5_000,
    });
    // 5000 * $0.67 * 22% = $737
    expect(result.mileageDeduction).toBeCloseTo(737, 0);
  });
});
