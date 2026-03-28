/**
 * Tests for pipeline-step1-ingest.ts — ingestUberEatsOrders()
 *
 * Strategy: ingest functions open real files via path.join(process.cwd(), 'databases').
 * We intercept `better-sqlite3` with a vi.mock factory that uses vi.importActual to get
 * the real module, then wraps every `new Database(filePath)` call to return a real
 * in-memory SQLite instance keyed by file path.  close() is proxied to a no-op so the
 * in-memory database survives across multiple open/close cycles within one test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type BetterSqlite3 from "better-sqlite3";

// ── Registry: survives across the module boundary ────────────────────────────
// Must be declared before vi.mock (which is hoisted) so the factory closure
// captures it correctly via the module scope.
const registry = new Map<string, BetterSqlite3.Database>();

vi.mock("better-sqlite3", async () => {
  // importActual returns the real better-sqlite3 constructor.
  const actual = await vi.importActual<{ default: typeof BetterSqlite3 }>("better-sqlite3");
  const RealDatabase = actual.default;

  function MockDatabase(this: unknown, filePath: string, opts?: BetterSqlite3.Options) {
    const key = typeof filePath === "string" ? filePath : ":anon:";
    if (!registry.has(key)) {
      // Open a real in-memory database — same engine, no disk I/O.
      registry.set(key, new RealDatabase(":memory:", opts ? { ...opts, readonly: false } : undefined));
    }
    const realDb = registry.get(key)!;

    // Proxy: silence close() so the in-memory DB persists across open/close cycles.
    return new Proxy(realDb, {
      get(target, prop: string) {
        if (prop === "close") return () => {};
        if (prop === "open") return true;
        const val = (target as unknown as Record<string, unknown>)[prop];
        return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(target) : val;
      },
    });
  }

  // Inherit the prototype so `instanceof` checks work.
  Object.setPrototypeOf(MockDatabase.prototype, RealDatabase.prototype);
  // Copy static methods from the real constructor.
  Object.assign(MockDatabase, RealDatabase);

  return { default: MockDatabase };
});

// Import the module under test AFTER the mock is declared.
import { ingestUberEatsOrders } from "../pipeline-step1-ingest";

// ── DB accessor ──────────────────────────────────────────────────────────────

function getUberEatsDb(): BetterSqlite3.Database {
  const { join } = require("path");
  const key = join(process.cwd(), "databases", "ubereats.db");
  return registry.get(key)!;
}

// ── Test data builders ───────────────────────────────────────────────────────

function makeOrder(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    order_id: "UE-001",
    order_uuid: "uuid-001",
    date: "2026-01-15",
    time: "12:30:00",
    customer: "Test Customer",
    customer_uuid: "cust-001",
    customer_order_count: "3",
    order_status: "Completed",
    fulfillment_type: "DELIVERY",
    sales_excl_tax: "25.50",
    tax: "2.04",
    marketplace_fee: "-5.36",
    marketplace_fee_rate: "21%",
    customer_refunds: "0",
    order_charges: "-5.56",
    estimated_payout: "16.58",
    source: "extension",
    ...overrides,
  };
}

function makeItemsJson(
  items: Array<{
    name: string;
    price: string;
    quantity?: number;
    customizations?: Array<{
      name: string;
      options?: Array<{ name: string; price?: string }>;
    }>;
  }>
): string {
  return JSON.stringify(
    items.map(i => ({
      uuid: `item-uuid-${i.name}`,
      name: i.name,
      price: i.price,
      quantity: i.quantity ?? 1,
      customizations: i.customizations ?? [],
      specialInstructions: "",
    }))
  );
}

// ── Per-test isolation ───────────────────────────────────────────────────────

beforeEach(() => {
  registry.clear();
});

// ── Tests: basic insertion ────────────────────────────────────────────────────

describe("ingestUberEatsOrders — basic insertion", () => {
  it("returns platform=ubereats, inserted=1, skipped=0, no errors for a valid order", () => {
    const result = ingestUberEatsOrders([makeOrder()]);

    expect(result.platform).toBe("ubereats");
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("maps order_id, date, order_status, fulfillment_type, customer into orders table", () => {
    ingestUberEatsOrders([makeOrder()]);

    const db = getUberEatsDb();
    const row = db
      .prepare("SELECT order_id, date, order_status, fulfillment_type, customer FROM orders WHERE order_id = 'UE-001'")
      .get() as Record<string, string>;

    expect(row.order_id).toBe("UE-001");
    expect(row.date).toBe("2026-01-15");
    expect(row.order_status).toBe("Completed");
    expect(row.fulfillment_type).toBe("DELIVERY");
    expect(row.customer).toBe("Test Customer");
  });

  it("parses dollar-amount strings to numbers (strips $ and commas)", () => {
    ingestUberEatsOrders([makeOrder({ sales_excl_tax: "$25.50", marketplace_fee: "-$5.36" })]);

    const db = getUberEatsDb();
    const row = db
      .prepare("SELECT sales_excl_tax, marketplace_fee, tax FROM orders WHERE order_id = 'UE-001'")
      .get() as Record<string, number>;

    expect(row.sales_excl_tax).toBeCloseTo(25.50, 2);
    expect(row.marketplace_fee).toBeCloseTo(-5.36, 2);
    expect(row.tax).toBeCloseTo(2.04, 2);
  });

  it("normalizes M/D/YYYY date format to YYYY-MM-DD", () => {
    ingestUberEatsOrders([makeOrder({ date: "1/15/2026" })]);

    const db = getUberEatsDb();
    const { date } = db
      .prepare("SELECT date FROM orders WHERE order_id = 'UE-001'")
      .get() as { date: string };

    expect(date).toBe("2026-01-15");
  });

  it("normalizes MM/DD/YYYY date format to YYYY-MM-DD", () => {
    ingestUberEatsOrders([makeOrder({ order_id: "UE-002", date: "03/22/2026" })]);

    const db = getUberEatsDb();
    const { date } = db
      .prepare("SELECT date FROM orders WHERE order_id = 'UE-002'")
      .get() as { date: string };

    expect(date).toBe("2026-03-22");
  });

  it("increments cleaned counter when date was reformatted", () => {
    const result = ingestUberEatsOrders([makeOrder({ date: "1/15/2026" })]);
    expect(result.cleaned).toBe(1);
  });

  it("does not increment cleaned counter when date is already YYYY-MM-DD", () => {
    const result = ingestUberEatsOrders([makeOrder()]);
    expect(result.cleaned).toBe(0);
  });
});

// ── Tests: deduplication ─────────────────────────────────────────────────────

describe("ingestUberEatsOrders — deduplication", () => {
  it("skips a second insert with the same order_id", () => {
    ingestUberEatsOrders([makeOrder()]);
    const result = ingestUberEatsOrders([makeOrder()]);

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("leaves exactly one row in orders after two inserts of the same order_id", () => {
    ingestUberEatsOrders([makeOrder()]);
    ingestUberEatsOrders([makeOrder()]);

    const db = getUberEatsDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM orders WHERE order_id = 'UE-001'")
      .get() as { cnt: number };

    expect(cnt).toBe(1);
  });

  it("preserves original field values when a duplicate is rejected", () => {
    ingestUberEatsOrders([makeOrder({ sales_excl_tax: "25.50" })]);
    ingestUberEatsOrders([makeOrder({ sales_excl_tax: "99.99" })]);

    const db = getUberEatsDb();
    const row = db
      .prepare("SELECT sales_excl_tax FROM orders WHERE order_id = 'UE-001'")
      .get() as { sales_excl_tax: number };

    expect(row.sales_excl_tax).toBeCloseTo(25.50, 2);
  });

  it("inserts all orders when every order_id is distinct", () => {
    ingestUberEatsOrders([
      makeOrder({ order_id: "UE-001" }),
      makeOrder({ order_id: "UE-002" }),
    ]);

    const db = getUberEatsDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM orders")
      .get() as { cnt: number };

    expect(cnt).toBe(2);
  });
});

// ── Tests: items table ───────────────────────────────────────────────────────

describe("ingestUberEatsOrders — items table", () => {
  it("inserts one row per item in items_json", () => {
    const itemsJson = makeItemsJson([
      { name: "Fruitella Crêpe", price: "14.50", quantity: 1 },
      { name: "Cortado", price: "4.00", quantity: 2 },
    ]);
    ingestUberEatsOrders([makeOrder({ items_json: itemsJson })]);

    const db = getUberEatsDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM items WHERE order_id = 'UE-001'")
      .get() as { cnt: number };

    expect(cnt).toBe(2);
  });

  it("maps item_name, quantity, and price correctly", () => {
    const itemsJson = makeItemsJson([{ name: "Fruitella Crêpe", price: "14.50", quantity: 1 }]);
    ingestUberEatsOrders([makeOrder({ items_json: itemsJson })]);

    const db = getUberEatsDb();
    const item = db
      .prepare("SELECT item_name, quantity, price FROM items WHERE order_id = 'UE-001'")
      .get() as Record<string, unknown>;

    expect(item.item_name).toBe("Fruitella Crêpe");
    expect(item.quantity).toBe(1);
    expect(item.price).toBeCloseTo(14.50, 2);
  });

  it("associates items with the correct order_id", () => {
    const itemsJson = makeItemsJson([{ name: "Test Item", price: "10.00" }]);
    ingestUberEatsOrders([makeOrder({ order_id: "UE-LINK", items_json: itemsJson })]);

    const db = getUberEatsDb();
    const item = db
      .prepare("SELECT order_id FROM items WHERE item_name = 'Test Item'")
      .get() as { order_id: string };

    expect(item.order_id).toBe("UE-LINK");
  });

  it("inserts zero item rows when items_json field is absent", () => {
    ingestUberEatsOrders([makeOrder()]);

    const db = getUberEatsDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM items WHERE order_id = 'UE-001'")
      .get() as { cnt: number };

    expect(cnt).toBe(0);
  });

  it("records an error and inserts no items when items_json is malformed JSON", () => {
    const result = ingestUberEatsOrders([makeOrder({ items_json: "NOT_VALID_JSON" })]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("UE-001");

    const db = getUberEatsDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM items WHERE order_id = 'UE-001'")
      .get() as { cnt: number };

    expect(cnt).toBe(0);
  });
});

// ── Tests: modifiers_json structure ─────────────────────────────────────────

describe("ingestUberEatsOrders — modifiers_json structure", () => {
  it("produces [{group, name, price}] array stored as valid JSON string", () => {
    const itemsJson = makeItemsJson([
      {
        name: "Al Capone Crêpe",
        price: "14.50",
        customizations: [
          {
            name: "Extras",
            options: [
              { name: "Extra Nutella", price: "$1.50" },
              { name: "No Banana" },
            ],
          },
        ],
      },
    ]);

    ingestUberEatsOrders([makeOrder({ items_json: itemsJson })]);

    const db = getUberEatsDb();
    const item = db
      .prepare("SELECT modifiers_json FROM items WHERE order_id = 'UE-001'")
      .get() as { modifiers_json: string };

    expect(() => JSON.parse(item.modifiers_json)).not.toThrow();

    const mods = JSON.parse(item.modifiers_json) as { group: string; name: string; price: number }[];
    expect(mods).toHaveLength(2);

    const paid = mods.find(m => m.name === "Extra Nutella")!;
    expect(paid.group).toBe("Extras");
    expect(paid.price).toBeCloseTo(1.50, 2);

    const free = mods.find(m => m.name === "No Banana")!;
    expect(free.group).toBe("Extras");
    expect(free.price).toBe(0);
  });

  it("stores empty string for modifiers_json when item has no customizations", () => {
    const itemsJson = makeItemsJson([{ name: "Plain Crêpe", price: "12.00" }]);
    ingestUberEatsOrders([makeOrder({ items_json: itemsJson })]);

    const db = getUberEatsDb();
    const item = db
      .prepare("SELECT modifiers_json FROM items WHERE order_id = 'UE-001'")
      .get() as { modifiers_json: string };

    expect(item.modifiers_json).toBe("");
  });

  it("also stores a human-readable flat modifiers string", () => {
    const itemsJson = makeItemsJson([
      {
        name: "Cappuccino",
        price: "4.50",
        customizations: [
          { name: "Milk", options: [{ name: "Oat Milk", price: "$0.75" }] },
        ],
      },
    ]);

    ingestUberEatsOrders([makeOrder({ items_json: itemsJson })]);

    const db = getUberEatsDb();
    const item = db
      .prepare("SELECT modifiers FROM items WHERE order_id = 'UE-001'")
      .get() as { modifiers: string };

    expect(item.modifiers).toContain("Oat Milk");
    expect(item.modifiers).toContain("Milk");
  });

  it("groups modifiers from multiple customization groups correctly", () => {
    const itemsJson = makeItemsJson([
      {
        name: "Complex Item",
        price: "20.00",
        customizations: [
          { name: "Size", options: [{ name: "Large", price: "$2.00" }] },
          { name: "Add-ons", options: [{ name: "Whipped Cream" }, { name: "Sprinkles" }] },
        ],
      },
    ]);

    ingestUberEatsOrders([makeOrder({ items_json: itemsJson })]);

    const db = getUberEatsDb();
    const item = db
      .prepare("SELECT modifiers_json FROM items WHERE order_id = 'UE-001'")
      .get() as { modifiers_json: string };

    const mods = JSON.parse(item.modifiers_json) as { group: string; name: string }[];
    expect(mods).toHaveLength(3);
    expect(mods.map(m => m.group)).toContain("Size");
    expect(mods.map(m => m.group)).toContain("Add-ons");
  });
});

// ── Tests: edge cases ────────────────────────────────────────────────────────

describe("ingestUberEatsOrders — edge cases", () => {
  it("handles an empty rows array without crashing", () => {
    const result = ingestUberEatsOrders([]);
    expect(result.inserted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("defaults financial fields to 0 when row has only order_id", () => {
    ingestUberEatsOrders([{ order_id: "UE-EMPTY" }]);

    const db = getUberEatsDb();
    const row = db
      .prepare("SELECT sales_excl_tax, tax, marketplace_fee FROM orders WHERE order_id = 'UE-EMPTY'")
      .get() as Record<string, number>;

    expect(row.sales_excl_tax).toBe(0);
    expect(row.tax).toBe(0);
    expect(row.marketplace_fee).toBe(0);
  });

  it("recognizes column names with spaces via key normalization", () => {
    const result = ingestUberEatsOrders([{ "order id": "UE-SPACE", date: "2026-01-15" }]);

    expect(result.inserted).toBe(1);

    const db = getUberEatsDb();
    const row = db
      .prepare("SELECT order_id FROM orders WHERE order_id = 'UE-SPACE'")
      .get() as { order_id: string };

    expect(row.order_id).toBe("UE-SPACE");
  });

  it("inserts all three orders in a single batch call", () => {
    const result = ingestUberEatsOrders([
      makeOrder({ order_id: "BATCH-1" }),
      makeOrder({ order_id: "BATCH-2" }),
      makeOrder({ order_id: "BATCH-3" }),
    ]);

    expect(result.inserted).toBe(3);

    const db = getUberEatsDb();
    const { cnt } = db
      .prepare("SELECT COUNT(*) as cnt FROM orders")
      .get() as { cnt: number };

    expect(cnt).toBe(3);
  });

  it("stores negative customer_refunds as a negative number", () => {
    ingestUberEatsOrders([makeOrder({ customer_refunds: "-5.00" })]);

    const db = getUberEatsDb();
    const row = db
      .prepare("SELECT customer_refunds FROM orders WHERE order_id = 'UE-001'")
      .get() as { customer_refunds: number };

    expect(row.customer_refunds).toBeCloseTo(-5.00, 2);
  });
});
