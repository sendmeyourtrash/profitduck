# Data Integrity Agent — Learnings

<!-- Append-only. Never delete entries. Max 200 lines — consolidate if approaching. -->

## Patterns
<!-- Recurring issues seen 2+ times -->
- **[2026-03-25]** Cross-database consistency checks are essential after every pipeline run. Cannot JOIN across databases — must query each DB separately and compare counts/totals in application code or scripts.
- **[2026-03-25]** SHA256-based dedup hashes are critical for data integrity. Never change hash field composition without understanding reimport consequences — changing the hash formula will cause all existing records to be treated as new on next import.

## Incidents
<!-- One-off findings with date stamps -->
- **[2026-03-25]** Agent created. Priority checks after any pipeline run: vendor DB counts vs sales.db counts, orphaned order_items, duplicate hashes, and line-item-to-order-total math validation.
