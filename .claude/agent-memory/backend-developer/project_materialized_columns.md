---
name: Materialized column migration pattern
description: How to safely add a materialized/denormalized column to existing bank tables with idempotent migration
type: project
---

When adding a materialized column to an existing SQLite table in this project:

1. Guard ALTER TABLE with `PRAGMA table_info(table)` check — never run ALTER TABLE unconditionally.
2. `CREATE INDEX IF NOT EXISTS` is always safe to run again; no guard needed.
3. Rebuild function accepts an optional `externalDb` so it can be called during migration (same connection) or standalone (opens/closes its own).
4. `rebuildDisplayVendors` is called from `ensureDisplayVendorColumn` which is called from `getDb()` — runs on every DB open, keeping data fresh.
5. The `all_bank_transactions` view uses `SELECT *` so new columns on the base tables appear automatically — no view alteration needed.
6. `cachedAliases = null` must be cleared at the start of any rebuild to pick up latest vendor_aliases rows.

**Why:** display_vendor materializes alias resolution so queries/filters can use the column directly rather than re-resolving at read time.
**How to apply:** Use this same pattern for any future denormalized/computed column additions to bank.db tables.
