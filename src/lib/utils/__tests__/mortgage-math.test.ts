/**
 * Tests for mortgage-math.ts
 *
 * Verifies:
 *  - Standard amortization formula produces known-good values
 *  - Schedule converges to zero balance
 *  - PMI drops off at 80% LTV
 *  - Extra principal + biweekly payments shorten the schedule and save interest
 *  - Tax savings respect standard deduction, SALT cap, and $750k mortgage cap
 *  - Rent vs buy has a reasonable break-even under standard assumptions
 *  - Affordability bisection finds the max home price at ~28% DTI
 */

import { describe, it, expect } from "vitest";
import {
  monthlyPrincipalAndInterest,
  generateAmortizationSchedule,
  monthlyPITI,
  calculateTaxSavings,
  calculateRentVsBuy,
  calculateAffordability,
  summarize,
  loanAmount,
  standardDeduction,
  MORTGAGE_INTEREST_CAP,
  SALT_CAP,
  type MortgageInputs,
  type TaxInputs,
} from "../mortgage-math";

const STANDARD: MortgageInputs = {
  homePrice: 400_000,
  downPayment: 80_000,
  loanTermYears: 30,
  interestRate: 6.5,
  propertyTaxRate: 1.1,
  hoaMonthly: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Monthly P&I
// ─────────────────────────────────────────────────────────────────────────────

describe("monthlyPrincipalAndInterest", () => {
  it("matches the known value for $320k / 30yr / 6.5%", () => {
    // $320k principal, 6.5%, 30 years → $2022.62/mo (standard amortization)
    const pi = monthlyPrincipalAndInterest(STANDARD);
    expect(pi).toBeCloseTo(2022.62, 1);
  });

  it("matches a second known value for $300k / 30yr / 6%", () => {
    // $300k @ 6% 30yr → $1798.65/mo
    const pi = monthlyPrincipalAndInterest({
      homePrice: 300_000,
      downPayment: 0,
      loanTermYears: 30,
      interestRate: 6,
    });
    expect(pi).toBeCloseTo(1798.65, 1);
  });

  it("returns 0 for a zero-principal (cash) purchase", () => {
    expect(
      monthlyPrincipalAndInterest({
        homePrice: 200_000,
        downPayment: 200_000,
        loanTermYears: 30,
        interestRate: 6,
      })
    ).toBe(0);
  });

  it("handles 0% interest by dividing principal evenly", () => {
    const pi = monthlyPrincipalAndInterest({
      homePrice: 120_000,
      downPayment: 0,
      loanTermYears: 10,
      interestRate: 0,
    });
    expect(pi).toBeCloseTo(1000, 4); // 120k / 120 months
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Amortization schedule
// ─────────────────────────────────────────────────────────────────────────────

describe("generateAmortizationSchedule", () => {
  it("produces exactly loanTermYears × 12 entries for a standard loan", () => {
    const schedule = generateAmortizationSchedule(STANDARD);
    expect(schedule.length).toBe(360);
  });

  it("ends with zero balance (within $1)", () => {
    const schedule = generateAmortizationSchedule(STANDARD);
    const last = schedule[schedule.length - 1];
    expect(last.balance).toBeLessThan(1);
  });

  it("total principal paid equals the loan amount (within $1)", () => {
    const schedule = generateAmortizationSchedule(STANDARD);
    const totalPrincipal = schedule.reduce(
      (s, e) => s + e.principal + e.extraPrincipal,
      0
    );
    expect(Math.abs(totalPrincipal - loanAmount(STANDARD))).toBeLessThan(1);
  });

  it("interest decreases over the life of the loan", () => {
    const schedule = generateAmortizationSchedule(STANDARD);
    expect(schedule[0].interest).toBeGreaterThan(
      schedule[schedule.length - 1].interest
    );
  });

  it("PMI drops off at 80% LTV", () => {
    // 20% down → no PMI ever
    const noPmi = generateAmortizationSchedule(STANDARD);
    expect(noPmi.every((e) => !e.pmiActive)).toBe(true);

    // 10% down → PMI active at start, drops off later
    const withPmi = generateAmortizationSchedule({
      ...STANDARD,
      downPayment: 40_000, // 10%
    });
    expect(withPmi[0].pmiActive).toBe(true);
    expect(withPmi[withPmi.length - 1].pmiActive).toBe(false);
  });

  it("extra monthly principal shortens the schedule", () => {
    const standard = generateAmortizationSchedule(STANDARD);
    const withExtras = generateAmortizationSchedule({
      ...STANDARD,
      extraMonthlyPrincipal: 300,
    });
    expect(withExtras.length).toBeLessThan(standard.length);
  });

  it("biweekly payments shorten the schedule", () => {
    const standard = generateAmortizationSchedule(STANDARD);
    const biweekly = generateAmortizationSchedule({
      ...STANDARD,
      biweekly: true,
    });
    expect(biweekly.length).toBeLessThan(standard.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PITI
// ─────────────────────────────────────────────────────────────────────────────

describe("monthlyPITI", () => {
  it("sums all components correctly", () => {
    const piti = monthlyPITI(STANDARD);
    expect(piti.total).toBeCloseTo(
      piti.principalAndInterest +
        piti.propertyTax +
        piti.insurance +
        piti.pmi +
        piti.hoa,
      4
    );
  });

  it("charges PMI only when LTV > 80%", () => {
    const noPmi = monthlyPITI(STANDARD); // 20% down
    expect(noPmi.pmi).toBe(0);

    const withPmi = monthlyPITI({ ...STANDARD, downPayment: 40_000 }); // 10% down
    expect(withPmi.pmi).toBeGreaterThan(0);
  });

  it("property tax scales linearly with home price", () => {
    const a = monthlyPITI({ ...STANDARD, homePrice: 400_000 });
    const b = monthlyPITI({ ...STANDARD, homePrice: 800_000 });
    expect(b.propertyTax).toBeCloseTo(a.propertyTax * 2, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tax savings
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateTaxSavings", () => {
  const TAX: TaxInputs = {
    annualIncome: 120_000,
    filingStatus: "single",
    marginalTaxRate: 24,
    stateMarginalRate: 5,
  };

  it("returns zero itemization benefit when below the standard deduction", () => {
    // Small loan → little interest → likely below standard
    const result = calculateTaxSavings(
      { ...STANDARD, homePrice: 150_000, downPayment: 50_000 },
      { ...TAX, marginalTaxRate: 22, stateMarginalRate: 0 }
    );
    // Property tax on $150k @ 1.1% = $1650
    // Interest first year ≈ $6k
    // Total itemized ≈ $7.65k; standard single is $14.6k
    expect(result.shouldItemize).toBe(false);
    expect(result.itemizationBenefit).toBe(0);
    expect(result.annualFederalSavings).toBe(0);
  });

  it("returns positive savings when itemized exceeds standard", () => {
    // Larger loan → more interest → should itemize
    const result = calculateTaxSavings(
      { ...STANDARD, homePrice: 800_000, downPayment: 160_000 },
      { ...TAX, filingStatus: "single", marginalTaxRate: 32 }
    );
    expect(result.shouldItemize).toBe(true);
    expect(result.annualFederalSavings).toBeGreaterThan(0);
  });

  it("caps deductible interest at the $750k loan limit", () => {
    // $1.5M loan → half of interest is deductible
    const largeLoan = calculateTaxSavings(
      {
        homePrice: 2_000_000,
        downPayment: 500_000, // $1.5M loan
        loanTermYears: 30,
        interestRate: 6.5,
      },
      TAX
    );
    const smallLoan = calculateTaxSavings(
      {
        homePrice: 1_000_000,
        downPayment: 250_000, // $750k loan exactly
        loanTermYears: 30,
        interestRate: 6.5,
      },
      TAX
    );
    // Deductible interest on a $1.5M loan (capped at $750k)
    // should match the $750k loan's interest, within a small margin.
    expect(largeLoan.deductibleInterest).toBeCloseTo(
      smallLoan.deductibleInterest,
      -2
    );
  });

  it("caps SALT deduction at $10k combined", () => {
    // High state income tax + high property tax → SALT cap hit
    const result = calculateTaxSavings(
      { ...STANDARD, homePrice: 1_500_000, propertyTaxRate: 2.5 },
      { ...TAX, annualIncome: 500_000, stateMarginalRate: 8 }
    );
    expect(result.deductibleSalt).toBeCloseTo(SALT_CAP, 1);
    expect(result.saltCapHit).toBe(true);
  });

  it("exposes the correct standard deduction per filing status", () => {
    expect(standardDeduction("single")).toBe(14_600);
    expect(standardDeduction("married_joint")).toBe(29_200);
    expect(standardDeduction("head_of_household")).toBe(21_900);
  });

  it("exports the documented caps", () => {
    expect(MORTGAGE_INTEREST_CAP).toBe(750_000);
    expect(SALT_CAP).toBe(10_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rent vs Buy
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateRentVsBuy", () => {
  it("produces a timeline of the requested length", () => {
    const result = calculateRentVsBuy(STANDARD, {
      monthlyRent: 2500,
      yearsToCompare: 10,
    });
    expect(result.timeline.length).toBe(10);
  });

  it("finds a break-even year when buying eventually wins", () => {
    // Low rent → renting stays cheaper longer. High rent → buying wins faster.
    const highRent = calculateRentVsBuy(STANDARD, {
      monthlyRent: 3500,
      yearsToCompare: 30,
    });
    expect(highRent.breakEvenYear).not.toBeNull();
    expect(highRent.breakEvenYear!).toBeLessThan(30);
  });

  it("home value grows monotonically at the assumed appreciation rate", () => {
    const result = calculateRentVsBuy(STANDARD, {
      monthlyRent: 2500,
      homeAppreciation: 4,
      yearsToCompare: 10,
    });
    for (let i = 1; i < result.timeline.length; i++) {
      expect(result.timeline[i].homeValue).toBeGreaterThan(
        result.timeline[i - 1].homeValue
      );
    }
  });

  it("savingsFromBuying reflects renting minus buying over the horizon", () => {
    const result = calculateRentVsBuy(STANDARD, {
      monthlyRent: 3000,
      yearsToCompare: 30,
    });
    expect(result.savingsFromBuying).toBeCloseTo(
      result.totalRentingCost - result.totalBuyingCost,
      4
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Affordability
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateAffordability", () => {
  it("produces a max home price where PITI ≈ 28% of income", () => {
    const result = calculateAffordability(
      120_000, // $120k income
      40_000, // $40k down
      6.5,
      30
    );
    expect(result.maxMonthlyPayment).toBeCloseTo(120_000 / 12 * 0.28, 1);
    expect(result.maxHomePrice).toBeGreaterThan(40_000);

    // Verify the PITI at max home price is close to the 28% cap
    const piti = monthlyPITI({
      homePrice: result.maxHomePrice,
      downPayment: 40_000,
      loanTermYears: 30,
      interestRate: 6.5,
      propertyTaxRate: 1.1,
      homeInsuranceAnnual: result.maxHomePrice * 0.0035,
    });
    expect(piti.total).toBeLessThanOrEqual(result.maxMonthlyPayment + 1);
  });

  it("marks a house within budget correctly", () => {
    const result = calculateAffordability(
      200_000, // high income
      50_000,
      6.5,
      30,
      1.1,
      0.35,
      300_000 // modest home
    );
    expect(result.withinBudget).toBe(true);
  });

  it("marks a house out of budget correctly", () => {
    const result = calculateAffordability(
      60_000, // low income
      10_000,
      6.5,
      30,
      1.1,
      0.35,
      500_000 // overpriced
    );
    expect(result.withinBudget).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

describe("summarize", () => {
  it("reports payoffYears ≈ loanTermYears for a vanilla schedule", () => {
    const summary = summarize(STANDARD);
    expect(summary.payoffYears).toBeCloseTo(30, 0);
    expect(summary.interestSavedByExtras).toBe(0);
  });

  it("reports interestSavedByExtras > 0 when extras are applied", () => {
    const summary = summarize({
      ...STANDARD,
      extraMonthlyPrincipal: 500,
    });
    expect(summary.interestSavedByExtras).toBeGreaterThan(0);
    expect(summary.payoffYears).toBeLessThan(30);
  });
});
