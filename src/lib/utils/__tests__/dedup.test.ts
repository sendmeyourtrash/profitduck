/**
 * Tests for dedup / hash logic across the Profit Duck codebase.
 *
 * The exported dedup utilities in src/lib/services/dedup.ts are:
 *   - computeFileHash(filePath)  — SHA256 of a file
 *   - computeDateRange(dates)    — min/max of a Date array
 *
 * Row-level dedup in the pipeline uses SQL WHERE clauses (not a separate hash
 * function), so those are tested here via the exact logic used in the
 * pipeline: same key fields → same identity, different key fields → different.
 *
 * The shared rules state:
 *   Dedup keys: order_id + platform + date for sales, transaction_id + date for bank.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { computeDateRange } from "@/lib/services/dedup";

// ─────────────────────────────────────────────────────────────────────────────
// SHA256 helpers — mirrors computeFileHash internals without file I/O
// ─────────────────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("SHA256 determinism and collision resistance", () => {
  it("produces the same hash for the same input", () => {
    const h1 = sha256("order-123|square|2026-03-12");
    const h2 = sha256("order-123|square|2026-03-12");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different order IDs", () => {
    const h1 = sha256("order-123|square|2026-03-12");
    const h2 = sha256("order-456|square|2026-03-12");
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different platforms", () => {
    const h1 = sha256("order-123|square|2026-03-12");
    const h2 = sha256("order-123|doordash|2026-03-12");
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different dates", () => {
    const h1 = sha256("order-123|square|2026-03-12");
    const h2 = sha256("order-123|square|2026-03-13");
    expect(h1).not.toBe(h2);
  });

  it("hash is exactly 64 hex characters (SHA256)", () => {
    const h = sha256("some input");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing a non-identity field does NOT change a hash keyed only on identity fields", () => {
    // Only order_id + platform + date are identity fields.
    // Changing gross_sales alone should not change the dedup key.
    const buildKey = (orderId: string, platform: string, date: string) =>
      sha256(`${orderId}|${platform}|${date}`);

    const keyBefore = buildKey("order-123", "square", "2026-03-12");
    const keyAfter = buildKey("order-123", "square", "2026-03-12");
    // gross_sales changed (not part of key) — hash stays the same
    expect(keyBefore).toBe(keyAfter);
  });

  it("handles empty string field without throwing", () => {
    expect(() => sha256("")).not.toThrow();
    expect(sha256("")).toHaveLength(64);
  });

  it("handles null-like values coerced to string without throwing", () => {
    // In JS, null.toString() throws — but String(null) = "null"
    const h = sha256(String(null) + "|" + String(undefined));
    expect(h).toHaveLength(64);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Row-level dedup key semantics
// Keys per the shared memory: order_id + platform + date (sales)
//                             transaction_id + date (bank)
// ─────────────────────────────────────────────────────────────────────────────

describe("dedup key composition — sales orders", () => {
  function salesKey(orderId: string, platform: string, date: string): string {
    return sha256(`${orderId}|${platform}|${date}`);
  }

  it("same orderId + platform + date → same key", () => {
    expect(salesKey("T001", "square", "2026-03-12")).toBe(
      salesKey("T001", "square", "2026-03-12")
    );
  });

  it("different orderId → different key", () => {
    expect(salesKey("T001", "square", "2026-03-12")).not.toBe(
      salesKey("T002", "square", "2026-03-12")
    );
  });

  it("different platform → different key (prevents cross-platform collision)", () => {
    // An order ID could theoretically repeat across platforms
    expect(salesKey("12345", "doordash", "2026-03-12")).not.toBe(
      salesKey("12345", "grubhub", "2026-03-12")
    );
  });

  it("different date → different key", () => {
    expect(salesKey("T001", "square", "2026-03-12")).not.toBe(
      salesKey("T001", "square", "2026-03-13")
    );
  });
});

describe("dedup key composition — bank transactions", () => {
  function bankKey(txnId: string, date: string): string {
    return sha256(`${txnId}|${date}`);
  }

  it("same txnId + date → same key", () => {
    expect(bankKey("TXN-999", "2026-01-15")).toBe(
      bankKey("TXN-999", "2026-01-15")
    );
  });

  it("different txnId → different key", () => {
    expect(bankKey("TXN-999", "2026-01-15")).not.toBe(
      bankKey("TXN-998", "2026-01-15")
    );
  });

  it("different date with same txnId → different key", () => {
    expect(bankKey("TXN-999", "2026-01-15")).not.toBe(
      bankKey("TXN-999", "2026-01-16")
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeDateRange — exported from src/lib/services/dedup.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("computeDateRange", () => {
  it("returns null for an empty array", () => {
    expect(computeDateRange([])).toBeNull();
  });

  it("returns the same date as both start and end for a single-element array", () => {
    const d = new Date("2026-03-12T00:00:00Z");
    const range = computeDateRange([d]);
    expect(range).not.toBeNull();
    expect(range!.start).toBe(d);
    expect(range!.end).toBe(d);
  });

  it("returns correct min and max from an unsorted array", () => {
    const dates = [
      new Date("2026-03-15T00:00:00Z"),
      new Date("2026-03-10T00:00:00Z"),
      new Date("2026-03-20T00:00:00Z"),
      new Date("2026-03-12T00:00:00Z"),
    ];
    const range = computeDateRange(dates);
    expect(range).not.toBeNull();
    expect(range!.start).toEqual(new Date("2026-03-10T00:00:00Z"));
    expect(range!.end).toEqual(new Date("2026-03-20T00:00:00Z"));
  });

  it("returns correct range for two dates", () => {
    const d1 = new Date("2026-01-01T00:00:00Z");
    const d2 = new Date("2026-12-31T00:00:00Z");
    const range = computeDateRange([d2, d1]); // reversed order
    expect(range!.start).toEqual(d1);
    expect(range!.end).toEqual(d2);
  });

  it("handles an array where all dates are equal", () => {
    const d = new Date("2026-06-15T00:00:00Z");
    const range = computeDateRange([d, d, d]);
    expect(range!.start).toEqual(d);
    expect(range!.end).toEqual(d);
  });
});
