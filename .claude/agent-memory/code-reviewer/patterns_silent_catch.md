---
name: Silent catch on ALTER TABLE swallows real errors
description: Pattern of catch {} on ALTER TABLE ADD COLUMN that hides non-duplicate-column failures
type: feedback
---

Both UE and DD step1 migrations use bare `catch {}` when attempting ALTER TABLE ADD COLUMN, intending to swallow "column already exists." This also swallows locked DB, full disk, and corrupted schema errors.

**Why:** Was flagged in 2026-03-27 review for the UE table and again in 2026-03-30 review for the DD table. The fix was not applied in both places consistently.

**How to apply:** Any `try { db.exec("ALTER TABLE ... ADD COLUMN") } catch {}` must be `catch (e) { if (!e.message.includes("duplicate column")) throw e; }`. Check every ingest function when reviewing step1 changes.
