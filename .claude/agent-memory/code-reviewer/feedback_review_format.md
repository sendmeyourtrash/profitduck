---
name: Review format and delivery preferences
description: How the owner expects code reviews to be structured and what level of depth is expected
type: feedback
---

Owner wants every code review finding FIXED, not just reported. Reviews should be actionable with exact line references and concrete fix descriptions. Parameter counting should be done explicitly (list each column and value position). Financial math must be traced through the full pipeline — normalizer → step1 → step2 — not just spot-checked at one layer.

**Why:** Owner notices data inconsistencies faster than most. Shipping wrong numbers costs more than a delayed review.

**How to apply:** Always trace financial fields end-to-end. Count INSERT parameters explicitly by listing them. Flag sign-convention ambiguities even when the code won't crash.
