/**
 * Tests for financial math patterns used across the Profit Duck codebase.
 *
 * Covers:
 *   - parseAmount() in pipeline-step1-ingest.ts (not exported, so tested via safeFloat equivalent)
 *   - parseAmount() / parseAmt() in pipeline-step2-unify.ts (not exported)
 *   - safeFloat() from src/lib/utils/format.ts (exported)
 *   - Math.round(x * 100) / 100 precision pattern
 *   - Floating-point accumulation edge cases
 */

import { describe, it, expect } from "vitest";
import { safeFloat } from "@/lib/utils/format";

// ─────────────────────────────────────────────────────────────────────────────
// safeFloat — the exported equivalent of the internal parseAmount / parseAmt
// Used in parsers (square.ts, ubereats.ts) to convert raw CSV strings to numbers.
// ─────────────────────────────────────────────────────────────────────────────

describe("safeFloat — basic string parsing", () => {
  it("parses a plain positive number string", () => {
    expect(safeFloat("25.50")).toBe(25.5);
  });

  it("parses a dollar-prefixed amount", () => {
    expect(safeFloat("$1,234.56")).toBe(1234.56);
  });

  it("parses a negative dollar amount", () => {
    expect(safeFloat("-$45.67")).toBe(-45.67);
  });

  it("parses zero", () => {
    expect(safeFloat("$0.00")).toBe(0);
  });

  it("parses amounts with commas as thousands separators", () => {
    expect(safeFloat("$10,000.00")).toBe(10000);
  });

  it("parses a negative plain string", () => {
    expect(safeFloat("-123.45")).toBe(-123.45);
  });

  it("parses a positive number with leading dollar and no cents", () => {
    expect(safeFloat("$100")).toBe(100);
  });
});

describe("safeFloat — null, undefined, empty input", () => {
  it("returns 0 for empty string", () => {
    expect(safeFloat("")).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(safeFloat(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(safeFloat(undefined)).toBe(0);
  });

  it("returns 0 for a string that is only whitespace", () => {
    expect(safeFloat("   ")).toBe(0);
  });

  it("returns 0 for a non-numeric string", () => {
    expect(safeFloat("N/A")).toBe(0);
  });

  it("returns 0 for a dash (common CSV placeholder)", () => {
    expect(safeFloat("-")).toBe(0);
  });
});

describe("safeFloat — numeric values passed directly", () => {
  it("returns a positive number unchanged", () => {
    expect(safeFloat(42.99)).toBe(42.99);
  });

  it("returns a negative number unchanged", () => {
    expect(safeFloat(-10.5)).toBe(-10.5);
  });

  it("returns 0 unchanged", () => {
    expect(safeFloat(0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dollar-sign prefix variants — Uber Eats CSV uses "$" prefix on amounts.
// ─────────────────────────────────────────────────────────────────────────────

describe("safeFloat — Uber Eats '$' prefix format", () => {
  it('parses "$15.99"', () => {
    expect(safeFloat("$15.99")).toBe(15.99);
  });

  it('parses "$-5.00" (negative with dollar prefix)', () => {
    // "$-5.00" — dollar first then minus — after stripping $ becomes "-5.00"
    expect(safeFloat("$-5.00")).toBe(-5);
  });

  it('parses "-$3.82" (minus then dollar)', () => {
    expect(safeFloat("-$3.82")).toBe(-3.82);
  });

  it('parses "$0.75" (modifier price)', () => {
    expect(safeFloat("$0.75")).toBe(0.75);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cents / rounding — pipeline-step2-unify.ts uses Math.round(x * 100) / 100
// for unitPrice computation and netSales. These tests validate the pattern.
// ─────────────────────────────────────────────────────────────────────────────

describe("Math.round(x * 100) / 100 — 2-decimal precision", () => {
  it("preserves exact 2-decimal values", () => {
    const result = Math.round(25.5 * 100) / 100;
    expect(result).toBe(25.5);
  });

  it("rounds 0.005 up to 0.01", () => {
    // Banker's rounding in some engines — this tests standard JS rounding
    const result = Math.round(0.005 * 100) / 100;
    expect(result).toBe(0.01);
  });

  it("rounds down when third decimal < 5", () => {
    const result = Math.round(12.344 * 100) / 100;
    expect(result).toBe(12.34);
  });

  it("rounds up when third decimal >= 5", () => {
    const result = Math.round(12.345 * 100) / 100;
    expect(result).toBe(12.35);
  });

  it("handles a large financial amount accurately", () => {
    const result = Math.round(9999.999 * 100) / 100;
    expect(result).toBe(10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Floating-point accumulation — the critical rule from shared memory:
// "NEVER use JavaScript floating point for money." These tests demonstrate
// WHY the Math.round pattern is necessary.
// ─────────────────────────────────────────────────────────────────────────────

describe("floating-point edge cases — why rounding is required", () => {
  it("0.1 + 0.2 demonstrates floating-point imprecision", () => {
    // Classic JS floating point issue
    const raw = 0.1 + 0.2;
    expect(raw).not.toBe(0.3);
    expect(raw).toBeCloseTo(0.3, 10); // close but not exact
  });

  it("7.95 * 3 rounded to 2 decimals equals 23.85", () => {
    const result = Math.round(7.95 * 3 * 100) / 100;
    expect(result).toBe(23.85);
  });

  it("0.1 + 0.2 has floating-point error without rounding", () => {
    const raw = 0.1 + 0.2;
    expect(raw).not.toBe(0.3);
  });

  it("0.1 + 0.2 rounded to 2 decimals equals 0.30", () => {
    const result = Math.round((0.1 + 0.2) * 100) / 100;
    expect(result).toBe(0.3);
  });

  it("accumulating 3 fees: 1.00 + 2.50 + 0.75 equals exactly 4.25", () => {
    const fees = [1.0, 2.5, 0.75];
    const total = Math.round(fees.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(total).toBe(4.25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit price derivation — pipeline-step2-unify.ts:
//   const unitPrice = qty > 0 ? Math.round((gross / qty) * 100) / 100 : 0;
// ─────────────────────────────────────────────────────────────────────────────

describe("unit price calculation from gross/qty", () => {
  it("divides gross by qty and rounds to 2 decimals", () => {
    const gross = 25.5;
    const qty = 3;
    const unitPrice = Math.round((gross / qty) * 100) / 100;
    expect(unitPrice).toBe(8.5);
  });

  it("returns 0 when qty is 0 (avoid divide-by-zero)", () => {
    const gross = 25.5;
    const qty = 0;
    const unitPrice = qty > 0 ? Math.round((gross / qty) * 100) / 100 : 0;
    expect(unitPrice).toBe(0);
  });

  it("handles single-unit item (qty=1) returning the gross itself", () => {
    const gross = 12.99;
    const qty = 1;
    const unitPrice = Math.round((gross / qty) * 100) / 100;
    expect(unitPrice).toBe(12.99);
  });

  it("rounds correctly when division produces 3+ decimals", () => {
    // $10.00 / 3 = 3.3333... → rounds to 3.33
    const gross = 10.0;
    const qty = 3;
    const unitPrice = Math.round((gross / qty) * 100) / 100;
    expect(unitPrice).toBe(3.33);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fee sign conventions — pipeline-step2-unify.ts normalizes all fees to
// negative numbers: commissionFee = -Math.abs(comm)
// ─────────────────────────────────────────────────────────────────────────────

describe("fee sign normalization — all fees must be negative", () => {
  it("makes a positive commission fee negative", () => {
    const comm = 3.82;
    const commissionFee = -Math.abs(comm);
    expect(commissionFee).toBe(-3.82);
  });

  it("keeps an already-negative commission fee negative", () => {
    const comm = -3.82;
    const commissionFee = -Math.abs(comm);
    expect(commissionFee).toBe(-3.82);
  });

  it("handles a zero fee", () => {
    const comm = 0;
    const commissionFee = -Math.abs(comm);
    // -0 and 0 are equal with Object.is only if both are same sign
    // In practice, -Math.abs(0) produces -0, which is fine for financial math
    expect(commissionFee + 0).toBe(0); // -0 + 0 === 0
  });

  it("feesTotal sums multiple negative fees", () => {
    const commissionFee = -3.82;
    const processingFee = -0.99;
    const deliveryFee = -0;
    const feesTotal = commissionFee + processingFee + deliveryFee;
    expect(feesTotal).toBe(-4.81);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Net sales computation — pipeline-step2-unify.ts (Square):
//   netSales = Math.round((gross + discounts + feesTotal) * 100) / 100
// discounts is already negative in that context.
// ─────────────────────────────────────────────────────────────────────────────

describe("net sales computation", () => {
  it("subtracts discounts and fees from gross", () => {
    const gross = 25.5;
    const discounts = -2.0; // negative (deduction)
    const feesTotal = -0.99; // negative (deduction)
    const netSales = Math.round((gross + discounts + feesTotal) * 100) / 100;
    expect(netSales).toBe(22.51);
  });

  it("returns gross when there are no discounts or fees", () => {
    const gross = 15.0;
    const discounts = 0;
    const feesTotal = 0;
    const netSales = Math.round((gross + discounts + feesTotal) * 100) / 100;
    expect(netSales).toBe(15.0);
  });

  it("handles full refund where gross is 0 after discount", () => {
    const gross = 0;
    const discounts = 0;
    const feesTotal = 0;
    const netSales = Math.round((gross + discounts + feesTotal) * 100) / 100;
    expect(netSales).toBe(0);
  });
});
