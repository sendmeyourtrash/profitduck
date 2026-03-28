/**
 * Tests for the Uber Eats CSV parser (src/lib/parsers/ubereats.ts).
 *
 * Real columns from Uber Eats merchant CSV export:
 *   Order ID, Date, Customer, Order status,
 *   Sales (excl. tax), Tax, Marketplace fee,
 *   Customer refunds, Order charges, Estimated payout
 *
 * Key behaviors:
 * - Cancelled/canceled orders are silently skipped (no platformOrder created)
 * - Amounts may include "$" prefix
 * - commissionFee = marketplaceFee + orderCharges (both taken as absolute values)
 * - Refunds > 0 produce a separate expense transaction
 */

import { describe, it, expect } from "vitest";
import { ubereatsParser } from "@/lib/parsers/ubereats";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "Order ID": "UE-ORDER-001",
    Date: "3/12/2026",
    Customer: "John Doe",
    "Order status": "Completed",
    "Sales (excl. tax)": "$25.50",
    Tax: "$2.04",
    "Marketplace fee": "-$3.82",
    "Customer refunds": "$0.00",
    "Order charges": "$0.00",
    "Estimated payout": "$23.72",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// detect()
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.detect()", () => {
  it("returns high confidence for a filename containing 'uber'", () => {
    const score = ubereatsParser.detect("uber_eats_transactions.csv", []);
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("returns high confidence for a filename containing 'ubereats'", () => {
    const score = ubereatsParser.detect("ubereats_2026.csv", []);
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("returns high confidence when 3+ Uber Eats-specific headers are present", () => {
    const headers = [
      "Marketplace fee",
      "Estimated payout",
      "Sales (excl. tax)",
      "Customer refunds",
      "Order charges",
    ];
    const score = ubereatsParser.detect("report.csv", headers);
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("returns moderate confidence when 2 Uber Eats headers match", () => {
    const headers = ["Marketplace fee", "Estimated payout"];
    const score = ubereatsParser.detect("report.csv", headers);
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThan(0.9);
  });

  it("returns 0 for a Square CSV", () => {
    const score = ubereatsParser.detect("square_sales.csv", [
      "Gross Sales",
      "Net Sales",
      "Transaction ID",
      "Payment ID",
      "Event Type",
    ]);
    expect(score).toBe(0);
  });

  it("returns 0 for a Chase bank CSV", () => {
    const score = ubereatsParser.detect("chase_activity.csv", [
      "Transaction Date",
      "Post Date",
      "Description",
      "Amount",
    ]);
    expect(score).toBe(0);
  });

  it("returns 0 for a DoorDash CSV", () => {
    const score = ubereatsParser.detect("doordash_payout.csv", [
      "Doordash Order ID",
      "Subtotal",
      "Commission",
      "Net Total",
    ]);
    expect(score).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — basic happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — completed order", () => {
  it("produces one platformOrder for a completed order", () => {
    const result = ubereatsParser.parse([makeRow()]);
    expect(result.platformOrders).toHaveLength(1);
  });

  it("identifies platform as 'ubereats'", () => {
    const result = ubereatsParser.parse([makeRow()]);
    expect(result.platformOrders[0].platform).toBe("ubereats");
  });

  it("captures orderId from the Order ID column", () => {
    const result = ubereatsParser.parse([makeRow()]);
    expect(result.platformOrders[0].orderId).toBe("UE-ORDER-001");
  });

  it("parses Sales (excl. tax) stripping the $ prefix", () => {
    const result = ubereatsParser.parse([makeRow({ "Sales (excl. tax)": "$25.50" })]);
    expect(result.platformOrders[0].subtotal).toBe(25.5);
  });

  it("parses Tax stripping the $ prefix", () => {
    const result = ubereatsParser.parse([makeRow({ Tax: "$2.04" })]);
    expect(result.platformOrders[0].tax).toBe(2.04);
  });

  it("parses Estimated payout as netPayout", () => {
    const result = ubereatsParser.parse([makeRow({ "Estimated payout": "$23.72" })]);
    expect(result.platformOrders[0].netPayout).toBe(23.72);
  });

  it("sets deliveryFee to 0 (not exposed in this CSV format)", () => {
    const result = ubereatsParser.parse([makeRow()]);
    expect(result.platformOrders[0].deliveryFee).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — Marketplace fee (commission)
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — Marketplace fee", () => {
  it("uses absolute value of negative Marketplace fee", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Marketplace fee": "-$3.82", "Order charges": "$0.00" }),
    ]);
    // commissionFee = marketplaceFee + orderCharges = 3.82 + 0 = 3.82
    expect(result.platformOrders[0].commissionFee).toBeCloseTo(3.82, 2);
  });

  it("sums Marketplace fee and Order charges into commissionFee", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Marketplace fee": "-$3.82", "Order charges": "$2.00" }),
    ]);
    expect(result.platformOrders[0].commissionFee).toBeCloseTo(5.82, 2);
  });

  it("produces a fee transaction when totalFees > 0", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Marketplace fee": "-$3.82" }),
    ]);
    const fees = result.transactions.filter((t) => t.type === "fee");
    expect(fees).toHaveLength(1);
    expect(fees[0].sourcePlatform).toBe("ubereats");
    expect(fees[0].category).toBe("commission");
    expect(fees[0].amount).toBeCloseTo(3.82, 2);
  });

  it("does not produce a fee transaction when Marketplace fee is 0", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Marketplace fee": "$0.00", "Order charges": "$0.00" }),
    ]);
    const fees = result.transactions.filter((t) => t.type === "fee");
    expect(fees).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — income transaction
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — income transaction", () => {
  it("produces an income transaction for a completed order with gross revenue > 0", () => {
    const result = ubereatsParser.parse([makeRow()]);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income).toHaveLength(1);
    expect(income[0].sourcePlatform).toBe("ubereats");
    expect(income[0].category).toBe("delivery_sales");
  });

  it("income amount is Sales (excl. tax) + Tax", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Sales (excl. tax)": "$25.50", Tax: "$2.04" }),
    ]);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income[0].amount).toBeCloseTo(27.54, 2);
  });

  it("income description includes the Order ID", () => {
    const result = ubereatsParser.parse([makeRow({ "Order ID": "UE-ORDER-999" })]);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income[0].description).toContain("UE-ORDER-999");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — refunds
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — customer refunds", () => {
  it("produces an expense transaction when Customer refunds > 0", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Customer refunds": "$5.00" }),
    ]);
    const refunds = result.transactions.filter((t) => t.category === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].type).toBe("expense");
    expect(refunds[0].amount).toBe(5);
  });

  it("sets refunds field on platformOrder when Customer refunds > 0", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Customer refunds": "$5.00" }),
    ]);
    expect(result.platformOrders[0].refunds).toBe(5);
  });

  it("does not produce a refund transaction when Customer refunds is 0", () => {
    const result = ubereatsParser.parse([makeRow({ "Customer refunds": "$0.00" })]);
    const refunds = result.transactions.filter((t) => t.category === "refund");
    expect(refunds).toHaveLength(0);
  });

  it("handles a negative refund amount in the CSV (takes absolute value)", () => {
    // Some exports show refunds as negative values
    const result = ubereatsParser.parse([
      makeRow({ "Customer refunds": "-$5.00" }),
    ]);
    const refunds = result.transactions.filter((t) => t.category === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — cancelled orders
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — cancelled orders", () => {
  it("skips a row with Order status = 'Cancelled'", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Order status": "Cancelled" }),
    ]);
    expect(result.platformOrders).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
  });

  it("skips a row with Order status = 'canceled' (lowercase variant)", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Order status": "canceled" }),
    ]);
    expect(result.platformOrders).toHaveLength(0);
  });

  it("still increments rowsProcessed for cancelled rows", () => {
    const result = ubereatsParser.parse([
      makeRow({ "Order status": "Cancelled" }),
    ]);
    expect(result.rowsProcessed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — date formats
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — date formats", () => {
  it("parses M/D/YYYY date format (Uber Eats native format)", () => {
    const result = ubereatsParser.parse([makeRow({ Date: "3/12/2026" })]);
    expect(result.platformOrders).toHaveLength(1);
    const dt = result.platformOrders[0].orderDatetime;
    expect(dt).toBeInstanceOf(Date);
    expect(isNaN(dt.getTime())).toBe(false);
  });

  it("records an error and skips when date is invalid", () => {
    const result = ubereatsParser.parse([makeRow({ Date: "" })]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.platformOrders).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("ubereatsParser.parse() — edge cases", () => {
  it("handles an empty rows array without throwing", () => {
    expect(() => ubereatsParser.parse([])).not.toThrow();
    const result = ubereatsParser.parse([]);
    expect(result.platformOrders).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles missing Order ID by generating a fallback ID", () => {
    const result = ubereatsParser.parse([makeRow({ "Order ID": "" })]);
    expect(result.platformOrders).toHaveLength(1);
    // fallback id starts with "ue-"
    expect(result.platformOrders[0].orderId).toMatch(/^ue-/);
  });

  it("handles zero gross sales (e.g., fully comped order)", () => {
    const result = ubereatsParser.parse([
      makeRow({
        "Sales (excl. tax)": "$0.00",
        Tax: "$0.00",
        "Estimated payout": "$0.00",
      }),
    ]);
    // grossRevenue = 0 → no income transaction, but platformOrder may still be created
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income).toHaveLength(0);
  });

  it("rawData is a non-empty JSON string", () => {
    const result = ubereatsParser.parse([makeRow()]);
    const order = result.platformOrders[0];
    expect(typeof order.rawData).toBe("string");
    expect(() => JSON.parse(order.rawData)).not.toThrow();
  });

  it("processes multiple rows and produces the correct count", () => {
    const rows = [
      makeRow({ "Order ID": "UE-001" }),
      makeRow({ "Order ID": "UE-002" }),
      makeRow({ "Order ID": "UE-003", "Order status": "Cancelled" }),
    ];
    const result = ubereatsParser.parse(rows);
    // 2 completed + 1 cancelled (skipped)
    expect(result.platformOrders).toHaveLength(2);
    expect(result.rowsProcessed).toBe(3);
  });
});
