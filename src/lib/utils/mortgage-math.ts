/**
 * Mortgage math utilities.
 *
 * Pure, side-effect-free functions used by the /tools/mortgage calculator.
 * All money values are JavaScript numbers; round at display boundaries with
 * formatCurrency() or Math.round(x * 100) / 100 when storing.
 *
 * Formulas:
 *   - Monthly payment: M = P × (r(1+r)^n) / ((1+r)^n − 1)
 *     where P = principal, r = monthly rate, n = number of months
 *   - PMI required while LTV > 80% (drops automatically in the schedule)
 *   - Biweekly: pay half the monthly amount every 2 weeks → 26 half-payments
 *     = 13 monthly payments per year, shortens the schedule
 *
 * References:
 *   - IRS Pub 936 (Home Mortgage Interest Deduction)
 *   - TCJA (2017): $750k mortgage interest cap, $10k SALT cap
 *   - CFPB "Ability to Repay" 43% DTI guideline (we use the stricter 28% rule)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MortgageInputs {
  homePrice: number;
  downPayment: number;
  loanTermYears: number;
  /** Annual interest rate as a percent, e.g. 6.5 = 6.5%. */
  interestRate: number;
  propertyTaxRate?: number;
  homeInsuranceAnnual?: number;
  pmiRate?: number;
  hoaMonthly?: number;
  closingCostsPercent?: number;
  /** Extra monthly principal payment in dollars. Default 0. */
  extraMonthlyPrincipal?: number;
  /** If true, apply 13 monthly payments per year (biweekly acceleration). */
  biweekly?: boolean;
}

export interface AmortizationEntry {
  paymentNumber: number;
  principal: number;
  interest: number;
  extraPrincipal: number;
  balance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
  pmiActive: boolean;
}

export interface MonthlyPITI {
  principalAndInterest: number;
  propertyTax: number;
  insurance: number;
  pmi: number;
  hoa: number;
  total: number;
}

export type FilingStatus = "single" | "married_joint" | "head_of_household";

export interface TaxInputs {
  annualIncome: number;
  filingStatus: FilingStatus;
  /** Federal marginal tax rate as a percent, e.g. 22 = 22%. */
  marginalTaxRate: number;
  /** State marginal tax rate as a percent. Default 0. */
  stateMarginalRate?: number;
  /** Other itemized deductions (charity, medical, etc.). Default 0. */
  otherItemizedDeductions?: number;
}

export interface TaxSavingsResult {
  deductibleInterest: number;
  deductibleSalt: number;
  otherDeductions: number;
  totalItemized: number;
  standardDeduction: number;
  itemizationBenefit: number;
  annualFederalSavings: number;
  annualStateSavings: number;
  annualTaxSavings: number;
  shouldItemize: boolean;
  saltCapHit: boolean;
}

export interface RentVsBuyInputs {
  monthlyRent: number;
  rentInflation?: number;
  homeAppreciation?: number;
  investmentReturn?: number;
  maintenancePercent?: number;
  sellingCostsPercent?: number;
  rentersInsuranceAnnual?: number;
  yearsToCompare?: number;
}

export interface RentVsBuyYearPoint {
  year: number;
  buyingNetCost: number;
  rentingNetCost: number;
  equity: number;
  homeValue: number;
  alternativeInvestment: number;
  cumulativeRentPaid: number;
  cumulativeOwnershipCost: number;
}

export interface RentVsBuyResult {
  timeline: RentVsBuyYearPoint[];
  breakEvenYear: number | null;
  totalBuyingCost: number;
  totalRentingCost: number;
  savingsFromBuying: number;
}

export interface AffordabilityResult {
  maxMonthlyPayment: number;
  maxHomePrice: number;
  housingDti: number;
  withinBudget: boolean;
  recommendedHomePrice: number;
}

export interface MortgageSummary {
  loanAmount: number;
  downPaymentPercent: number;
  monthlyPITI: MonthlyPITI;
  totalInterest: number;
  totalPayments: number;
  payoffMonths: number;
  payoffYears: number;
  interestSavedByExtras: number;
  upfrontCash: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core calculations
// ─────────────────────────────────────────────────────────────────────────────

export function loanAmount(inputs: MortgageInputs): number {
  return Math.max(0, inputs.homePrice - inputs.downPayment);
}

export function downPaymentPercent(inputs: MortgageInputs): number {
  if (inputs.homePrice <= 0) return 0;
  return (inputs.downPayment / inputs.homePrice) * 100;
}

/**
 * Standard amortizing monthly principal + interest payment.
 * Returns 0 for zero-principal loans (all-cash purchases).
 */
export function monthlyPrincipalAndInterest(inputs: MortgageInputs): number {
  const principal = loanAmount(inputs);
  if (principal <= 0) return 0;
  const n = inputs.loanTermYears * 12;
  const r = inputs.interestRate / 100 / 12;
  if (r === 0) return principal / n;
  const factor = Math.pow(1 + r, n);
  return (principal * (r * factor)) / (factor - 1);
}

/**
 * Month-by-month amortization schedule.
 * Supports extra principal payments and biweekly acceleration (13 monthly
 * payments per year). PMI drops off automatically at 80% LTV.
 *
 * The schedule length may be shorter than loanTermYears × 12 if extras or
 * biweekly payments pay off the loan early.
 */
export function generateAmortizationSchedule(
  inputs: MortgageInputs
): AmortizationEntry[] {
  const principal = loanAmount(inputs);
  const nMax = inputs.loanTermYears * 12;
  const r = inputs.interestRate / 100 / 12;
  const basePayment = monthlyPrincipalAndInterest(inputs);
  const extra = inputs.extraMonthlyPrincipal ?? 0;
  const pmiThreshold = inputs.homePrice * 0.8;
  // Biweekly: 26 half-payments per year ≈ 13 monthly payments per year,
  // modeled here as +1/12 extra principal each month.
  const biweeklyExtra = inputs.biweekly ? basePayment / 12 : 0;

  const schedule: AmortizationEntry[] = [];
  let balance = principal;
  let cumPrincipal = 0;
  let cumInterest = 0;

  for (let m = 1; m <= nMax && balance > 0.01; m++) {
    const interest = balance * r;
    const scheduledPrincipal = basePayment - interest;
    const extraThisMonth = extra + biweeklyExtra;
    let principalPaid = scheduledPrincipal + extraThisMonth;
    if (principalPaid > balance) principalPaid = balance;
    const extraApplied = Math.min(
      extraThisMonth,
      Math.max(0, principalPaid - scheduledPrincipal)
    );

    balance -= principalPaid;
    cumPrincipal += principalPaid;
    cumInterest += interest;

    schedule.push({
      paymentNumber: m,
      principal: principalPaid - extraApplied,
      interest,
      extraPrincipal: extraApplied,
      balance: Math.max(0, balance),
      cumulativePrincipal: cumPrincipal,
      cumulativeInterest: cumInterest,
      pmiActive: balance > pmiThreshold,
    });

    if (balance <= 0.01) break;
  }
  return schedule;
}

/**
 * First-month PITI breakdown used as the "headline" monthly cost.
 */
export function monthlyPITI(inputs: MortgageInputs): MonthlyPITI {
  const pi = monthlyPrincipalAndInterest(inputs);
  const propertyTaxRate = inputs.propertyTaxRate ?? 1.1;
  const hoa = inputs.hoaMonthly ?? 0;
  const insurance =
    inputs.homeInsuranceAnnual ?? inputs.homePrice * 0.0035;
  const pmiRate = inputs.pmiRate ?? 0.6;

  const propertyTax = (inputs.homePrice * (propertyTaxRate / 100)) / 12;
  const insuranceMonthly = insurance / 12;

  const principal = loanAmount(inputs);
  const ltv = inputs.homePrice > 0 ? principal / inputs.homePrice : 0;
  const pmi = ltv > 0.8 ? (principal * (pmiRate / 100)) / 12 : 0;

  return {
    principalAndInterest: pi,
    propertyTax,
    insurance: insuranceMonthly,
    pmi,
    hoa,
    total: pi + propertyTax + insuranceMonthly + pmi + hoa,
  };
}

/** Upfront cash required to close: down payment + closing costs. */
export function upfrontCashRequired(inputs: MortgageInputs): number {
  const closingRate = (inputs.closingCostsPercent ?? 3) / 100;
  return inputs.downPayment + inputs.homePrice * closingRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax savings
// ─────────────────────────────────────────────────────────────────────────────

/** 2024/2025 federal standard deductions. */
export function standardDeduction(status: FilingStatus): number {
  switch (status) {
    case "married_joint":
      return 29_200;
    case "head_of_household":
      return 21_900;
    case "single":
    default:
      return 14_600;
  }
}

export const MORTGAGE_INTEREST_CAP = 750_000;
export const SALT_CAP = 10_000;

/**
 * First-year federal + state tax savings estimate from itemizing.
 *
 * Only counts the benefit that exceeds the standard deduction — if you're
 * already taking the standard deduction, the mortgage produces no extra
 * federal savings (common for moderate incomes).
 *
 * SALT is capped at $10k combined (federal, TCJA) and the $750k loan cap
 * scales deductible interest proportionally when the loan is larger.
 */
export function calculateTaxSavings(
  mortgage: MortgageInputs,
  tax: TaxInputs
): TaxSavingsResult {
  const schedule = generateAmortizationSchedule(mortgage);
  const firstYearInterest = schedule
    .slice(0, 12)
    .reduce((sum, e) => sum + e.interest, 0);

  const principal = loanAmount(mortgage);
  const capRatio =
    principal > MORTGAGE_INTEREST_CAP ? MORTGAGE_INTEREST_CAP / principal : 1;
  const deductibleInterest = firstYearInterest * capRatio;

  const propertyTaxAnnual =
    mortgage.homePrice * ((mortgage.propertyTaxRate ?? 1.1) / 100);
  const stateIncomeTax =
    tax.annualIncome * ((tax.stateMarginalRate ?? 0) / 100);
  const combinedSalt = propertyTaxAnnual + stateIncomeTax;
  const deductibleSalt = Math.min(combinedSalt, SALT_CAP);
  const saltCapHit = combinedSalt > SALT_CAP;

  const otherItemized = tax.otherItemizedDeductions ?? 0;
  const totalItemized = deductibleInterest + deductibleSalt + otherItemized;
  const standard = standardDeduction(tax.filingStatus);
  const itemizationBenefit = Math.max(0, totalItemized - standard);

  // Federal savings only apply to the benefit above the standard deduction.
  const annualFederalSavings =
    itemizationBenefit * (tax.marginalTaxRate / 100);
  // Most states that permit itemizing allow interest + property tax without
  // a SALT cap. This is a rough estimate.
  const annualStateSavings =
    (deductibleInterest + propertyTaxAnnual) *
    ((tax.stateMarginalRate ?? 0) / 100);

  return {
    deductibleInterest,
    deductibleSalt,
    otherDeductions: otherItemized,
    totalItemized,
    standardDeduction: standard,
    itemizationBenefit,
    annualFederalSavings,
    annualStateSavings,
    annualTaxSavings: annualFederalSavings + annualStateSavings,
    shouldItemize: totalItemized > standard,
    saltCapHit,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Affordability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 28% rule affordability estimate.
 *
 * Back-solves the home price that keeps PITI at or below 28% of gross
 * monthly income using bisection. Accounts for property tax and insurance
 * scaling with home price.
 */
export function calculateAffordability(
  annualIncome: number,
  downPayment: number,
  interestRate: number,
  loanTermYears: number,
  propertyTaxRate = 1.1,
  insuranceRate = 0.35,
  currentHomePrice = 0
): AffordabilityResult {
  const monthlyIncome = annualIncome / 12;
  const maxMonthlyPayment = monthlyIncome * 0.28;

  let lo = downPayment;
  let hi = downPayment + 5_000_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const piti = monthlyPITI({
      homePrice: mid,
      downPayment,
      loanTermYears,
      interestRate,
      propertyTaxRate,
      homeInsuranceAnnual: mid * (insuranceRate / 100),
    });
    if (piti.total > maxMonthlyPayment) hi = mid;
    else lo = mid;
  }
  const maxHomePrice = lo;

  const currentPiti =
    currentHomePrice > 0
      ? monthlyPITI({
          homePrice: currentHomePrice,
          downPayment,
          loanTermYears,
          interestRate,
          propertyTaxRate,
          homeInsuranceAnnual: currentHomePrice * (insuranceRate / 100),
        }).total
      : 0;

  return {
    maxMonthlyPayment,
    maxHomePrice,
    housingDti: monthlyIncome > 0 ? (currentPiti / monthlyIncome) * 100 : 0,
    withinBudget: currentHomePrice === 0 || currentPiti <= maxMonthlyPayment,
    recommendedHomePrice: maxHomePrice * 0.8,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rent vs Buy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Year-by-year rent vs buy comparison.
 *
 * Buying: upfront + PITI + maintenance − tax savings − net sale proceeds.
 * Renting: cumulative rent + renters insurance − investment growth on the
 *          capital that would have been the down payment (+ any monthly
 *          savings when renting is cheaper than ownership's non-equity cost).
 *
 * Returns a timeline and the break-even year.
 */
export function calculateRentVsBuy(
  mortgage: MortgageInputs,
  rentVsBuy: RentVsBuyInputs,
  tax?: TaxInputs
): RentVsBuyResult {
  const years = rentVsBuy.yearsToCompare ?? mortgage.loanTermYears;
  const rentInflation = (rentVsBuy.rentInflation ?? 3) / 100;
  const appreciation = (rentVsBuy.homeAppreciation ?? 3) / 100;
  const investmentReturn = (rentVsBuy.investmentReturn ?? 7) / 100;
  const maintenancePct = (rentVsBuy.maintenancePercent ?? 1) / 100;
  const sellingCostsPct = (rentVsBuy.sellingCostsPercent ?? 6) / 100;
  const rentersInsurance = rentVsBuy.rentersInsuranceAnnual ?? 180;

  const schedule = generateAmortizationSchedule(mortgage);
  const piti = monthlyPITI(mortgage);
  const upfront = upfrontCashRequired(mortgage);
  const annualTaxSavings = tax
    ? calculateTaxSavings(mortgage, tax).annualTaxSavings
    : 0;

  const timeline: RentVsBuyYearPoint[] = [];

  let cumulativeOwnershipCost = upfront;
  let cumulativeRentPaid = 0;
  let homeValue = mortgage.homePrice;
  let currentRent = rentVsBuy.monthlyRent * 12;
  let alternativeInvestment = upfront;

  for (let year = 1; year <= years; year++) {
    const yearStart = (year - 1) * 12;
    const yearEnd = Math.min(year * 12, schedule.length);
    const yearSchedule = schedule.slice(yearStart, yearEnd);
    const yearInterest = yearSchedule.reduce((s, e) => s + e.interest, 0);
    const yearPrincipal = yearSchedule.reduce(
      (s, e) => s + e.principal + e.extraPrincipal,
      0
    );

    const yearPi = yearInterest + yearPrincipal;
    const yearTaxes = homeValue * ((mortgage.propertyTaxRate ?? 1.1) / 100);
    const yearInsurance = piti.insurance * 12;
    const yearHoa = piti.hoa * 12;
    const yearMaintenance = homeValue * maintenancePct;
    const yearPmi = yearSchedule.reduce(
      (s, e) => s + (e.pmiActive ? piti.pmi : 0),
      0
    );

    const yearOwnershipCost =
      yearPi +
      yearTaxes +
      yearInsurance +
      yearHoa +
      yearMaintenance +
      yearPmi -
      annualTaxSavings;
    cumulativeOwnershipCost += yearOwnershipCost;

    const yearRentCost = currentRent + rentersInsurance;
    cumulativeRentPaid += yearRentCost;

    // Alternative investment grows; add any monthly surplus when renting is
    // cheaper than the non-equity cost of ownership.
    const nonEquityOwningCost = yearOwnershipCost - yearPrincipal;
    const monthlySavings = (nonEquityOwningCost - yearRentCost) / 12;
    alternativeInvestment = alternativeInvestment * (1 + investmentReturn);
    if (monthlySavings > 0) {
      alternativeInvestment += monthlySavings * 12;
    }

    homeValue *= 1 + appreciation;

    const remainingBalance =
      yearSchedule[yearSchedule.length - 1]?.balance ?? 0;
    const equity = homeValue - remainingBalance;
    const saleProceeds =
      homeValue * (1 - sellingCostsPct) - remainingBalance;
    const buyingNetCost = cumulativeOwnershipCost - saleProceeds;

    const investmentGain = alternativeInvestment - upfront;
    const rentingNetCost = cumulativeRentPaid - investmentGain;

    timeline.push({
      year,
      buyingNetCost,
      rentingNetCost,
      equity,
      homeValue,
      alternativeInvestment,
      cumulativeRentPaid,
      cumulativeOwnershipCost,
    });

    currentRent *= 1 + rentInflation;
  }

  const breakEven = timeline.find((p) => p.buyingNetCost <= p.rentingNetCost);
  const last = timeline[timeline.length - 1];

  return {
    timeline,
    breakEvenYear: breakEven?.year ?? null,
    totalBuyingCost: last?.buyingNetCost ?? 0,
    totalRentingCost: last?.rentingNetCost ?? 0,
    savingsFromBuying: last
      ? last.rentingNetCost - last.buyingNetCost
      : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick summary of a mortgage scenario, including how much interest is saved
 * by extra-principal / biweekly compared to a vanilla schedule.
 */
export function summarize(inputs: MortgageInputs): MortgageSummary {
  const schedule = generateAmortizationSchedule(inputs);
  const totalInterest = schedule.reduce((s, e) => s + e.interest, 0);
  const totalPrincipal = schedule.reduce(
    (s, e) => s + e.principal + e.extraPrincipal,
    0
  );

  // Interest saved vs a vanilla schedule (no extras, no biweekly)
  let interestSavedByExtras = 0;
  if (inputs.extraMonthlyPrincipal || inputs.biweekly) {
    const vanilla = generateAmortizationSchedule({
      ...inputs,
      extraMonthlyPrincipal: 0,
      biweekly: false,
    });
    const vanillaInterest = vanilla.reduce((s, e) => s + e.interest, 0);
    interestSavedByExtras = Math.max(0, vanillaInterest - totalInterest);
  }

  return {
    loanAmount: loanAmount(inputs),
    downPaymentPercent: downPaymentPercent(inputs),
    monthlyPITI: monthlyPITI(inputs),
    totalInterest,
    totalPayments: totalInterest + totalPrincipal,
    payoffMonths: schedule.length,
    payoffYears: schedule.length / 12,
    interestSavedByExtras,
    upfrontCash: upfrontCashRequired(inputs),
  };
}
