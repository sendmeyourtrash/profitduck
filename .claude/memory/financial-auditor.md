# Financial Auditor Agent Memory

## Patterns Discovered
- 2026-03-27: Uber Eats `price` field is line total, not unit price — dividing by qty gives unit price
- 2026-03-27: Modifier revenue must accumulate in integer cents to avoid float drift
- 2026-03-27: SUM(order_items.gross_sales) must match orders.gross_sales within $0.02

## Common Mistakes Found
- 2026-03-27: Float accumulation `revenue += price` drifts over thousands of rows — use cents
- 2026-03-27: `net_sales` on order_items was inconsistent between real-items (gross) and fallback (payout)

## Lessons Learned
- 2026-03-27: Always round at storage boundary: Math.round(x * 100) / 100
- 2026-03-27: Cross-platform order_id collision possible — always filter by platform too
