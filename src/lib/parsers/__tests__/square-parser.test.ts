/**
 * Tests for the Square CSV parser (src/lib/parsers/square.ts).
 *
 * Square exports are item-level: multiple rows can share the same Transaction ID.
 * The parser groups by Transaction ID and produces one platformOrder + one
 * transaction per unique order.
 *
 * Real column names from Square's CSV export:
 *   Date, Time, Time Zone, Category, Item, Qty, Price Point Name, SKU,
 *   Modifiers Applied, Gross Sales, Discounts, Net Sales, Tax,
 *   Transaction ID, Payment ID, Device Name, Notes, Details, Event Type,
 *   Location, Dining Option, Customer ID, Customer Name, Customer Reference ID,
 *   Unit, Count, Itemization Type, Fulfillment Note, Channel, Token,
 *   Card Brand, PAN Suffix
 */

import { describe, it, expect } from "vitest";
import { squareParser } from "@/lib/parsers/square";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — realistic Square CSV rows
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Date: "2026-03-12",
    Time: "17:44:41",
    "Time Zone": "Eastern Time (US & Canada)",
    Category: "Sweet Crêpes",
    Item: "Classic Crêpe",
    Qty: "1",
    "Price Point Name": "Regular",
    SKU: "",
    "Modifiers Applied": "Nutella",
    "Gross Sales": "12.00",
    Discounts: "0.00",
    "Net Sales": "12.00",
    Tax: "0.96",
    "Transaction ID": "TXN-SQUARE-001",
    "Payment ID": "PAY-001",
    "Device Name": "Register 1",
    Notes: "",
    Details: "",
    "Event Type": "Payment",
    Location: "Main Location",
    "Dining Option": "Dine In",
    "Customer ID": "",
    "Customer Name": "Jane Smith",
    "Customer Reference ID": "",
    Unit: "",
    Count: "",
    "Itemization Type": "Item",
    "Fulfillment Note": "",
    Channel: "POS",
    Token: "",
    "Card Brand": "Visa",
    "PAN Suffix": "1234",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// detect()
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.detect()", () => {
  it("returns high confidence for a file named with 'square'", () => {
    const score = squareParser.detect("square_sales_2026.csv", []);
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it("returns high confidence when 3+ Square-specific headers are present", () => {
    const headers = [
      "Gross Sales",
      "Net Sales",
      "Transaction ID",
      "Payment ID",
      "Event Type",
      "Dining Option",
      "Itemization Type",
    ];
    const score = squareParser.detect("export.csv", headers);
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it("returns moderate confidence when 2 Square headers match", () => {
    const headers = ["Gross Sales", "Net Sales"];
    const score = squareParser.detect("export.csv", headers);
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(score).toBeLessThan(0.85);
  });

  it("returns 0 for a Chase bank CSV", () => {
    const score = squareParser.detect("chase.csv", [
      "Transaction Date",
      "Post Date",
      "Description",
      "Amount",
      "Type",
    ]);
    expect(score).toBe(0);
  });

  it("returns 0 for a DoorDash CSV", () => {
    const score = squareParser.detect("doordash_payout.csv", [
      "Doordash Order ID",
      "Subtotal",
      "Commission",
      "Net Total",
    ]);
    // 'square' is not in the filename and no square headers match
    expect(score).toBe(0);
  });

  it("returns 0 for an Uber Eats CSV", () => {
    const score = squareParser.detect("uber_eats_report.csv", [
      "Marketplace fee",
      "Estimated payout",
      "Sales (excl. tax)",
      "Customer refunds",
    ]);
    expect(score).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — single-item order
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.parse() — single-item Payment order", () => {
  it("produces one platformOrder for one unique Transaction ID", () => {
    const result = squareParser.parse([makeRow()]);
    expect(result.platformOrders).toHaveLength(1);
  });

  it("sets platform to 'square'", () => {
    const result = squareParser.parse([makeRow()]);
    expect(result.platformOrders[0].platform).toBe("square");
  });

  it("sets orderId to the Transaction ID", () => {
    const result = squareParser.parse([makeRow()]);
    expect(result.platformOrders[0].orderId).toBe("TXN-SQUARE-001");
  });

  it("computes subtotal as absolute value of Gross Sales", () => {
    const result = squareParser.parse([makeRow({ "Gross Sales": "12.00" })]);
    expect(result.platformOrders[0].subtotal).toBe(12);
  });

  it("computes tax correctly", () => {
    const result = squareParser.parse([makeRow({ Tax: "0.96" })]);
    expect(result.platformOrders[0].tax).toBe(0.96);
  });

  it("sets netPayout to netSales + tax (totalCollected)", () => {
    // totalCollected = netSales + tax = 12.00 + 0.96 = 12.96
    const result = squareParser.parse([
      makeRow({ "Net Sales": "12.00", Tax: "0.96" }),
    ]);
    expect(result.platformOrders[0].netPayout).toBeCloseTo(12.96, 2);
  });

  it("sets deliveryFee to 0 (Square POS has no delivery fee)", () => {
    const result = squareParser.parse([makeRow()]);
    expect(result.platformOrders[0].deliveryFee).toBe(0);
  });

  it("sets commissionFee to 0 (not in item-level CSV)", () => {
    const result = squareParser.parse([makeRow()]);
    expect(result.platformOrders[0].commissionFee).toBe(0);
  });

  it("captures diningOption from the CSV", () => {
    const result = squareParser.parse([makeRow({ "Dining Option": "Dine In" })]);
    expect(result.platformOrders[0].diningOption).toBe("Dine In");
  });

  it("captures cardBrand from the CSV", () => {
    const result = squareParser.parse([makeRow({ "Card Brand": "Visa" })]);
    expect(result.platformOrders[0].cardBrand).toBe("Visa");
  });

  it("captures channel from the CSV", () => {
    const result = squareParser.parse([makeRow({ Channel: "POS" })]);
    expect(result.platformOrders[0].channel).toBe("POS");
  });

  it("produces one income transaction for a completed order", () => {
    const result = squareParser.parse([makeRow()]);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income).toHaveLength(1);
    expect(income[0].sourcePlatform).toBe("square");
    expect(income[0].category).toBe("in_store_sales");
  });

  it("increments rowsProcessed", () => {
    const result = squareParser.parse([makeRow()]);
    expect(result.rowsProcessed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — multi-item order (same Transaction ID across rows)
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.parse() — multi-item order", () => {
  const rows = [
    makeRow({
      Item: "Classic Crêpe",
      "Gross Sales": "12.00",
      "Net Sales": "12.00",
      Tax: "0.96",
    }),
    makeRow({
      Item: "Lemonade",
      "Gross Sales": "4.50",
      "Net Sales": "4.50",
      Tax: "0.36",
    }),
  ];

  it("produces exactly one platformOrder when both rows share the same Transaction ID", () => {
    const result = squareParser.parse(rows);
    expect(result.platformOrders).toHaveLength(1);
  });

  it("sums Gross Sales across line items", () => {
    const result = squareParser.parse(rows);
    expect(result.platformOrders[0].subtotal).toBeCloseTo(16.5, 2);
  });

  it("sums Tax across line items", () => {
    const result = squareParser.parse(rows);
    expect(result.platformOrders[0].tax).toBeCloseTo(1.32, 2);
  });

  it("counts rowsProcessed for each row", () => {
    const result = squareParser.parse(rows);
    expect(result.rowsProcessed).toBe(2);
  });

  it("produces one income transaction (not one per item)", () => {
    const result = squareParser.parse(rows);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — discounts
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.parse() — discounts", () => {
  it("records a discount transaction when Discounts > 0", () => {
    const result = squareParser.parse([
      makeRow({ Discounts: "-2.00" }),
    ]);
    const discounts = result.transactions.filter((t) => t.category === "discount");
    expect(discounts).toHaveLength(1);
    expect(discounts[0].type).toBe("expense");
    expect(discounts[0].amount).toBe(2);
  });

  it("does not produce a discount transaction when Discounts is 0", () => {
    const result = squareParser.parse([makeRow({ Discounts: "0.00" })]);
    const discounts = result.transactions.filter((t) => t.category === "discount");
    expect(discounts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — Refund event type
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.parse() — Refund event type", () => {
  it("produces an expense transaction categorized as 'refund'", () => {
    const result = squareParser.parse([
      makeRow({
        "Event Type": "Refund",
        "Gross Sales": "-12.00",
        "Net Sales": "-12.00",
        Tax: "-0.96",
        "Transaction ID": "TXN-REFUND-001",
      }),
    ]);
    const refunds = result.transactions.filter((t) => t.category === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].type).toBe("expense");
  });

  it("does not produce an income transaction for a refund", () => {
    const result = squareParser.parse([
      makeRow({
        "Event Type": "Refund",
        "Gross Sales": "-12.00",
        "Net Sales": "-12.00",
        Tax: "-0.96",
        "Transaction ID": "TXN-REFUND-001",
      }),
    ]);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — missing / null fields
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.parse() — missing or empty fields", () => {
  it("skips rows with no Transaction ID and records no orders", () => {
    const result = squareParser.parse([makeRow({ "Transaction ID": "" })]);
    expect(result.platformOrders).toHaveLength(0);
  });

  it("handles missing Category without throwing", () => {
    const result = squareParser.parse([makeRow({ Category: "" })]);
    // Should still produce an order, just without itemCategory
    expect(result.platformOrders).toHaveLength(1);
    // itemCategory should be undefined when category is empty
    expect(result.platformOrders[0].itemCategory).toBeUndefined();
  });

  it("handles missing Dining Option gracefully", () => {
    const result = squareParser.parse([makeRow({ "Dining Option": "" })]);
    expect(result.platformOrders[0].diningOption).toBeUndefined();
  });

  it("handles missing Card Brand gracefully", () => {
    const result = squareParser.parse([makeRow({ "Card Brand": "" })]);
    expect(result.platformOrders[0].cardBrand).toBeUndefined();
  });

  it("handles zero Gross Sales without throwing", () => {
    const result = squareParser.parse([makeRow({ "Gross Sales": "0.00", "Net Sales": "0.00", Tax: "0.00" })]);
    // totalCollected = 0 → no income transaction, but platformOrder is still created
    expect(result.platformOrders).toHaveLength(1);
    const income = result.transactions.filter((t) => t.type === "income");
    expect(income).toHaveLength(0);
  });

  it("handles an empty rows array without throwing", () => {
    expect(() => squareParser.parse([])).not.toThrow();
    const result = squareParser.parse([]);
    expect(result.platformOrders).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse() — date handling
// ─────────────────────────────────────────────────────────────────────────────

describe("squareParser.parse() — date handling", () => {
  it("records an error for an unparseable date and skips the order", () => {
    const result = squareParser.parse([
      makeRow({ Date: "not-a-date", Time: "" }),
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.platformOrders).toHaveLength(0);
  });

  it("parses a YYYY-MM-DD date correctly", () => {
    const result = squareParser.parse([makeRow({ Date: "2026-03-12" })]);
    expect(result.platformOrders).toHaveLength(1);
    const dt = result.platformOrders[0].orderDatetime;
    expect(dt).toBeInstanceOf(Date);
    expect(isNaN(dt.getTime())).toBe(false);
  });
});
