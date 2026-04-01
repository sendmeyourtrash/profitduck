# Platform Data Agent Memory

## Patterns Discovered
- 2026-03-27: Square API does NOT provide dining option (For Here/To Go) — known gap since 2021
- 2026-03-27: Square modifier prices come from total_price_money.amount (cents), not base_price_money
- 2026-03-27: Uber Eats GraphQL OrderDetails returns full item + modifier + customization data
- 2026-03-27: Chrome extension MAIN/ISOLATED worlds are completely isolated — no cross-world communication
- 2026-03-27: Uber Eats orders list uses React fiber state, not DOM attributes — extract via __reactFiber$

## Common Mistakes Found
- 2026-03-27: Hardcoding "For Here" as dining option default — should be null/empty when data doesn't exist
- 2026-03-27: Hardcoding "INCREPEABLE" as location — should use payment.location_id
- 2026-03-27: Flattening structured modifier JSON to strings loses price data

## Lessons Learned
- 2026-03-27: Store raw_json on every order for future re-extraction
- 2026-03-27: Always prefer structured JSON over flat strings for modifiers
- 2026-03-27: Backfill script v2 (payment → order_id → batch retrieve) is 100% reliable vs v1 (order search → tender matching) which missed 60%
