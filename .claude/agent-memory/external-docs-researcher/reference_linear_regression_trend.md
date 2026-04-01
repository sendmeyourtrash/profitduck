---
name: Linear Regression Trend Display for Financial Dashboards
description: How to correctly compute and label trend rates and projection totals from a daily-data linear regression. Covers slope × period² for change-in-monthly-total, sum-of-daily-estimates for projected totals, and label/projection consistency rules.
type: reference
---

The canonical reference for forecasting aggregates is Hyndman's *Forecasting: Principles and Practice*
(https://otexts.com/fpp2/aggregates.html). The key rule: sum daily point estimates to get projected period totals.

**The two interpretations of "monthly trend":**

- Interpretation A (slope × 30): change in *daily revenue* per month. "$7.91/mo" = daily revenue is $7.91 higher 30 days from now vs today. Technically correct but misleading to users.
- Interpretation B (slope × 30²): change in *monthly total revenue* per month. "$237/mo" = next month's total will be $237 more than this month's total. This is what users expect.

Always use Interpretation B for user-facing labels.

**Period formulas (Interpretation B):**

| Period | Multiplier |
|--------|-----------|
| $/day  | slope × 1 |
| $/week | slope × 49 |
| $/month | slope × 900 |
| $/year  | slope × 133225 |

**Projection total (closed form):**

```
n = number of projected days
yStart = slope * startDayIndex + intercept
yEnd   = slope * endDayIndex + intercept
projectedTotal = n * (yStart + yEnd) / 2
```

This is exact (arithmetic series). Equivalent to numDays × regression_value_at_midpoint.

**Consistency check:** month2_total − month1_total should equal slope × 900 (the badge value).

**Full research brief:** `.claude/research/linear-regression-trend-display.md`
