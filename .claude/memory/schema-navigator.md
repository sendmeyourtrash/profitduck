# Schema Navigator Agent Memory

## Patterns Discovered
- 2026-03-27: ubereats.db has both `orders` and `items` tables — items has modifiers_json column
- 2026-03-27: squareup.db items table has modifiers_applied (flat) + modifiers_json (structured) columns
- 2026-03-27: sales.db order_items.modifiers can contain JSON array OR flat string — check with LIKE '[%'
- 2026-03-27: orders.items is a pipe-separated summary string, NOT the source of truth — order_items table is

## Common Mistakes Found
- 2026-03-27: orders.items summary field can get out of sync with order_items table
- 2026-03-27: dining_option on orders can be empty string OR NULL — both mean "unknown"

## Lessons Learned
- 2026-03-27: Always check PRAGMA table_info before assuming column exists
- 2026-03-27: Cannot join across databases — query each separately
