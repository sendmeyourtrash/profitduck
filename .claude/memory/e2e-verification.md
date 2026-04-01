# E2E Verification Agent Memory

## Patterns Discovered
- 2026-03-27: Always check both light and dark mode when verifying UI changes
- 2026-03-27: Verify orders.items summary string matches actual order_items count
- 2026-03-27: Check modifier prices show correctly (paid = +$X.XX, free = $0.00)
- 2026-03-27: Verify dining option shows real data, not hardcoded defaults

## Common Mistakes Found
- 2026-03-27: Pipeline changes that look correct in DB can show wrong in UI (e.g., items summary using wrong separator)
- 2026-03-27: API returning data doesn't mean frontend is rendering it (order_items existed but page wasn't querying them)

## Lessons Learned
- 2026-03-27: Always verify at 3 levels: Database → API response → UI rendering
