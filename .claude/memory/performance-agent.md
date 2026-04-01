# Performance Agent — Learnings

<!-- Append-only. Never delete entries. Max 200 lines — consolidate if approaching. -->

## Patterns
<!-- Recurring issues seen 2+ times -->
- **[2026-03-25]** Step 3 (pipeline-step3-aliases.ts) reruns the full alias application across all order_items on every alias add/delete/edit. Should use targeted UPDATE for single-item changes instead of reprocessing 24K+ rows.
- **[2026-03-25]** Multi-database architecture means cross-DB joins happen in application code — watch for N+1 patterns when correlating vendor DBs with sales.db.

## Incidents
<!-- One-off findings with date stamps -->
- **[2026-03-25]** Agent created. Initial focus areas: Step 3 full-rerun optimization, SQL index audit on sales.db and bank.db, frontend pagination for large datasets.
