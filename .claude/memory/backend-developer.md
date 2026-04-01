# Backend Developer Agent Memory

## Patterns Discovered
- 2026-03-27: Step 3 pipeline re-run is expensive (24K+ items) — update display_name directly for single changes
- 2026-03-27: Uber Eats `price` field is line total, not unit price — unitPrice = lineTotal / qty
- 2026-03-27: Modifier JSON structure: [{group, name, price}] — consistent across Square and Uber Eats
- 2026-03-27: Square backfill v2 (payment → order_id → batch retrieve) is 100% reliable

## User Preferences
- Never hardcode restaurant-specific data (menu items, categories, filter lists)
- System must work for any restaurant — building for multi-tenant eventually
- Always show error messages to user — no silent failures
- Every API change needs CORS headers for extension compatibility
