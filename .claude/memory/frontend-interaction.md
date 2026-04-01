# Frontend Interaction Agent Memory

## Patterns Discovered
- 2026-03-27: Parse modifiers from JSON first, fall back to flat string for legacy data
- 2026-03-27: `order_items` should be fetched from API and attached to each transaction — not parsed from summary string
- 2026-03-27: Batch-fetch order_items with (order_id, platform) composite key — not just order_id

## User Preferences
- Delays between adding/deleting/editing are unacceptable — don't re-run full pipeline for single changes
- "Suggestions not decisions" — auto-mapping should recommend, not assign
- Confirm action for items that haven't changed names — one-click "this is correct"
- Show error messages on failure, never fail silently
