/**
 * Tests for bigramSimilarity() and findBestMatches() in string-similarity.ts.
 *
 * bigramSimilarity uses the Dice coefficient on character bigrams.
 * Formula: 2 * |intersection| / (|A| + |B|)
 * where A and B are the sets of bigrams in each string.
 */

import { describe, it, expect } from "vitest";
import {
  bigramSimilarity,
  findBestMatches,
} from "@/lib/utils/string-similarity";

// ─────────────────────────────────────────────────────────────────────────────
// Identical strings
// ─────────────────────────────────────────────────────────────────────────────

describe("bigramSimilarity — identical strings", () => {
  it('returns 1.0 for "hello" vs "hello"', () => {
    expect(bigramSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 1.0 for identical single-word strings", () => {
    expect(bigramSimilarity("doordash", "doordash")).toBe(1);
  });

  it("returns 1.0 for case-insensitive identical strings", () => {
    // The function lowercases both inputs before comparing
    expect(bigramSimilarity("HELLO", "hello")).toBe(1);
    expect(bigramSimilarity("DoorDash", "doordash")).toBe(1);
  });

  it("trims whitespace before comparing", () => {
    expect(bigramSimilarity("  hello  ", "hello")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Completely different strings
// ─────────────────────────────────────────────────────────────────────────────

describe("bigramSimilarity — no overlap", () => {
  it('returns 0 for "abc" vs "xyz"', () => {
    // bigrams of "abc": {"ab","bc"}, bigrams of "xyz": {"xy","yz"} — no overlap
    expect(bigramSimilarity("abc", "xyz")).toBe(0);
  });

  it('returns 0 for "cat" vs "dog"', () => {
    expect(bigramSimilarity("cat", "dog")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Partial similarity
// ─────────────────────────────────────────────────────────────────────────────

describe("bigramSimilarity — partial similarity", () => {
  it('returns > 0.5 for "hello" vs "helo" (one missing char)', () => {
    const score = bigramSimilarity("hello", "helo");
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns > 0 and < 1 for "grubhub" vs "grubhubs"', () => {
    const score = bigramSimilarity("grubhub", "grubhubs");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("vendor name partial match: DOORDASH PAYMENT vs doordash", () => {
    const score = bigramSimilarity("doordash payment", "doordash");
    expect(score).toBeGreaterThan(0.5);
  });

  it("scores higher for closer matches", () => {
    const closeScore = bigramSimilarity("uber eats", "ubereats");
    const farScore = bigramSimilarity("uber eats", "doordash");
    expect(closeScore).toBeGreaterThan(farScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases — short strings and empty strings
// ─────────────────────────────────────────────────────────────────────────────

describe("bigramSimilarity — edge cases", () => {
  it("returns 0 for single character strings (need at least 2 chars for a bigram)", () => {
    // "a" has no bigrams → score is 0 (unless a === b, which triggers the sa===sb early return)
    expect(bigramSimilarity("a", "b")).toBe(0);
  });

  it("returns 1 for identical single character strings (early-exit equality check)", () => {
    expect(bigramSimilarity("a", "a")).toBe(1);
  });

  it("returns 0 for empty string vs non-empty", () => {
    expect(bigramSimilarity("", "hello")).toBe(0);
  });

  it("returns 1 for two empty strings (both equal after trim)", () => {
    // "" === "" triggers the sa===sb early return path
    expect(bigramSimilarity("", "")).toBe(1);
  });

  it("returns 0 for two-char string vs unrelated two-char string", () => {
    // bigrams of "ab": {"ab"}, bigrams of "cd": {"cd"} — no overlap
    expect(bigramSimilarity("ab", "cd")).toBe(0);
  });

  it("returns 1 for identical two-char strings", () => {
    expect(bigramSimilarity("ab", "ab")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Symmetry — bigramSimilarity(a, b) === bigramSimilarity(b, a)
// ─────────────────────────────────────────────────────────────────────────────

describe("bigramSimilarity — symmetry", () => {
  it("is symmetric for partial matches", () => {
    const ab = bigramSimilarity("hello", "helo");
    const ba = bigramSimilarity("helo", "hello");
    expect(ab).toBe(ba);
  });

  it("is symmetric for no-overlap strings", () => {
    const ab = bigramSimilarity("abc", "xyz");
    const ba = bigramSimilarity("xyz", "abc");
    expect(ab).toBe(ba);
  });

  it("is symmetric for vendor names", () => {
    const ab = bigramSimilarity("rocket money", "rocketmoney");
    const ba = bigramSimilarity("rocketmoney", "rocket money");
    expect(ab).toBe(ba);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findBestMatches — used for alias suggestion in AliasManager
// ─────────────────────────────────────────────────────────────────────────────

describe("findBestMatches", () => {
  const candidates = [
    { name: "doordash" },
    { name: "grubhub" },
    { name: "uber eats" },
    { name: "square" },
    { name: "rocket money" },
  ];

  it("returns the best matching candidate for an exact match", () => {
    const results = findBestMatches("doordash", candidates);
    expect(results[0].name).toBe("doordash");
    expect(results[0].score).toBe(1);
  });

  it("returns results sorted by score descending", () => {
    const results = findBestMatches("doordash payment", candidates);
    // All returned results should be in descending score order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("returns at most topN results", () => {
    const results = findBestMatches("order", candidates, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("filters out results below the threshold", () => {
    // "zzz" has zero similarity with all candidates → nothing returned
    const results = findBestMatches("zzz", candidates, 5, 0.3);
    expect(results.length).toBe(0);
  });

  it("returns all results above a low threshold", () => {
    const results = findBestMatches("e", candidates, 10, 0.0);
    // With threshold 0.0, all candidates are included regardless of score
    expect(results.length).toBe(candidates.length);
  });

  it("includes the score field on each result", () => {
    const results = findBestMatches("doordash", candidates);
    expect(results[0]).toHaveProperty("score");
    expect(typeof results[0].score).toBe("number");
  });

  it("passes through all candidate fields alongside the score", () => {
    const richCandidates = [{ name: "doordash", id: 42 }];
    const results = findBestMatches("doordash", richCandidates);
    expect(results[0]).toMatchObject({ name: "doordash", id: 42 });
  });
});
