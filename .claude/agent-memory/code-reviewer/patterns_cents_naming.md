---
name: cents() helper converts FROM cents TO dollar string — misleading name
description: Extension helper named cents() actually divides by 100 and returns a dollar string, not a cent integer
type: feedback
---

The `cents()` function in content-grubhub.js (and potentially future extension scripts) does `(val / 100).toFixed(2)` — i.e., it converts an API cent-integer to a dollar decimal string. The name implies the opposite direction.

**Why:** The grubhub.db columns store TEXT dollar strings (same as CSV imports), so the conversion is correct for the pipeline. But the name will mislead the next person who adds a financial field and assumes `cents()` returns an integer in cents.

**How to apply:** When reviewing any extension normalizer that calls a helper named `cents`, `toCents`, or similar — verify the actual direction of conversion before assuming it stores integers. The correct name would be `toDollars` or `centsToDecimalStr`.
