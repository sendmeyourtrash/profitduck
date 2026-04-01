# Code Reviewer Agent Memory

## Patterns Discovered
- 2026-03-27: Cross-platform order_id collision — always filter by platform in batch queries
- 2026-03-27: Error responses must NOT include `detail: String(error)` — leaks internals
- 2026-03-27: Float accumulation for money must use integer cents, not raw floats
- 2026-03-27: `require()` mixed with ES imports — use the already-imported function
- 2026-03-27: TypeScript interfaces must match actual API response shapes — mismatched keys cause silent undefined
- 2026-03-27: `.replace("date", "oi.date")` string patching is fragile — build aliased conditions from scratch

## Common Mistakes Found
- 2026-03-27: `net_sales` semantics inconsistent between real-items path (gross) and fallback path (payout)
- 2026-03-27: Hardcoded `1` for qty in SQL INSERT when it should be parameterized
- 2026-03-27: Silent catch `catch (_) {}` on ALTER TABLE swallows real errors — check for "duplicate column"
- 2026-03-27: Unused variables left behind after refactoring (modList, old require imports)
- 2026-03-30: `unitPrice * qty` without rounding — float multiplication on money must use `Math.round(x*100)/100`
- 2026-03-30: `toISOString()` produces UTC but stored in "local" timestamp columns — timezone mismatch for extension data vs CSV data
- 2026-03-30: Raw API value passed into `adjustmentsTotal` without sign normalization — positive credits inflate total_fees deductions
- 2026-03-30: `promos` (raw) written to `discounts` column AND `marketingTotal` (normalized) written to marketing_total — same promo double-represented in two columns
- 2026-03-30: New financial field added to ubereats.db (delivery_fee) but never read in step2 — always written as 0 to sales.db with no comment explaining why
- 2026-03-31: Extension extractStoreId() URL-only extraction fails when triggerSync auto-opens a tab without store ID in the URL — need fallback extraction methods
- 2026-03-31: Extension API field mappings are speculative without verified API response samples — add logging for all-zero financial rows to detect mapping failures
- 2026-03-31: Pre-existing bug: `handleIntercepted` in background.js references undefined `platform` variable at line 430

## User Preferences
- Owner wants every code review finding FIXED, not just reported
- Owner notices data inconsistencies faster than most — don't ship without verifying numbers match
- "Suggestions not decisions" — the system recommends, user confirms
- No hardcoded restaurant-specific data — system must work for any restaurant
