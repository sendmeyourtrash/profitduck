---
name: Financial sign convention issues in delivery platform pipeline
description: Recurring pattern where raw API values are stored without sign normalization, or normalized values are stored in the wrong column
type: feedback
---

Several fields in the Uber Eats and DoorDash pipeline have been found storing values without documenting or enforcing a sign contract:

1. **adjustment_amount** (UE): API can return positive or negative. Step2 passes raw value into adjustmentsTotal, which flows into total_fees. A positive credit inadvertently inflates total_fees deductions.
2. **promotions / discounts column confusion** (UE step2): `promos` (raw) goes into the `discounts` slot, but `marketingTotal` (sign-normalized) is the correct value. Both end up in the output — double-representation of the same promo.
3. **delivery_fee captured but never read in step2** (UE): Stored in ubereats.db but always written as 0 to sales.db. No comment explaining why.

**Why:** Delivery platform APIs are inconsistent about whether deductions are stored as negative or positive. Each new field needs an explicit sign decision at ingest time.

**How to apply:** When reviewing any new financial field addition to the pipeline, ask: (a) what sign does the source API use? (b) what sign does the destination column expect? (c) is the same value being written to two columns? Trace from normalizer through step1 through step2.
