# Research Brief: Linear Regression Trend Rates and Projections for Financial Dashboards

## Context

Daily revenue data (e.g. 395 days). Linear regression: x = day index (0…394), y = daily revenue.
Slope ≈ 0.2635 means daily revenue grows by $0.26 per day. Need to display this as trend badges
and project forward totals for 3-month, 6-month, 1-year, 2-year horizons.

---

## The Core Conceptual Distinction (Critical)

There are TWO completely different things you can show as "monthly growth":

### Interpretation A — Change in daily revenue per month (slope × 30)
- "Daily revenue 30 days from now will be $7.91 higher than today's daily revenue."
- This is what `slope × 30` gives you.
- It answers: "By how much has the trend line itself moved over one month?"
- This is the standard textbook slope-scaling used by Excel, Google Sheets, and virtually every tool.

### Interpretation B — Change in monthly total per month (slope × 30 × 30 = slope × 900)
- "The total revenue earned in next month will be $237 more than the total earned in current month."
- This is what `slope × 30²` gives you.
- It answers: "How much more money accumulates across an entire month compared to the prior month?"

**Both are mathematically correct — they answer different questions.** The confusion arises from
labeling Interpretation A as "$/month" when users expect Interpretation B.

### Why they differ

If daily revenue is growing by slope `m` per day:
- Revenue on day `d` = `slope*d + intercept`
- Revenue this month (days 365 to 394): sum of 30 values, each ~$0.26 higher than the prior day
  - = 30 × avg_revenue_this_month
- Revenue next month (days 395 to 424): same structure but trending higher
  - Difference = 30 days × (slope × 30 day gap) = slope × 30 × 30 = slope × 900

So: `slope × 30 = $7.91` means "daily rate increases by $7.91/month"
    `slope × 900 = $237` means "monthly total increases by $237/month"

The arithmetic series math: the sum of 30 consecutive revenue values starting at day `a`:
```
Sum(a, a+29) = Σ(slope*i + intercept) for i=a..a+29
             = slope × Σi + 30 × intercept
             = slope × (30a + 435) + 30 × intercept  [since Σ0..29 = 435]
```
Difference between month starting at `a+30` vs month starting at `a`:
```
Sum(a+30, a+59) - Sum(a, a+29) = slope × 30 × 30 = slope × 900
```

---

## What Standard Tools Display

### Excel / Google Sheets trendlines
- Show the slope as "m" in `y = mx + b` on the chart.
- The value of `m` is the per-unit-of-x change (i.e., per day if x is days).
- Excel's "forecast forward N periods" extends the line by N x-units.
- **Excel does NOT automatically re-aggregate to period totals.** You must sum manually.
- Reference: https://support.microsoft.com/en-us/office/predict-data-trends-96a1d4be-5070-4928-85af-626fb5421a9a

### Tableau / Power BI
- Use exponential smoothing (Holt-Winters) or linear trend, shown at the same granularity as the data.
- If data is daily, the forecast is daily. You must aggregate the daily forecasts to get monthly totals.
- Reference: https://help.tableau.com/current/pro/desktop/en-us/forecast_how_it_works.htm

### Forecasting: Principles and Practice (Hyndman, the canonical text)
- Point forecasts for aggregates: "adding them up will give a good estimate of the total"
- The correct projected total for any future window is the sum of daily point estimates.
- Reference: https://otexts.com/fpp2/aggregates.html

---

## What Works

### Trend rate badge: use Interpretation B for user-facing display

**The user-expected meaning of "+$237/mo" is: "each month I earn ~$237 more than the month before."**
This is `slope × days_in_period²`.

| Period | Formula | Example (slope=0.2635) |
|--------|---------|------------------------|
| $/day  | slope | $0.26/day |
| $/week | slope × 7 × 7 | $12.90/week |
| $/month | slope × 30 × 30 | $237.15/month |
| $/quarter | slope × 91 × 91 | $2,183/quarter |
| $/year | slope × 365 × 365 | $35,130/year |

Note: if slope × 30 = $7.91/month is shown, the label should clarify it means
"daily revenue grows by $7.91/month" — not that the monthly total grows by $7.91. This is too
technical for most users, so prefer Interpretation B.

### Projected revenue totals: sum of daily point estimates

The correct formula for total projected revenue over a future window [startDay, endDay]:

```
projectedTotal = Σ (slope * i + intercept) for i = startDay..endDay
```

Using the arithmetic series closed form:
```
n = endDay - startDay + 1  (number of days)
yStart = slope * startDay + intercept
yEnd = slope * endDay + intercept
projectedTotal = n * (yStart + yEnd) / 2
```

This is exact (not an approximation). It equals `numDays × regression_value_at_midpoint_of_window`.

For Profit Duck with 395 historical days (index 0–394):
- Projection start index = 395 (tomorrow)
- For "next 3 months" (90 days): startDay=395, endDay=484
  - yStart = 0.2635×395 + intercept ≈ current_level + 0.2635
  - yEnd = 0.2635×484 + intercept
  - projectedTotal = 90 × (yStart + yEnd) / 2

### Relationship between badge and projection numbers

If badge shows "+$237/mo" (Interpretation B, slope × 900):
- Month 1 projected total ≈ current_monthly_avg + 0.5 × slope × 900 (halfway through first month above baseline)
- Month 2 projected total ≈ current_monthly_avg + 1.5 × slope × 900
- Month 3 projected total ≈ current_monthly_avg + 2.5 × slope × 900

The 3-month projection total = 3 × current_monthly_avg + (0.5 + 1.5 + 2.5) × (slope × 900)
                              = 3 × current_monthly_avg + 4.5 × (slope × 900)

This means the badge number times 4.5 should roughly equal the 3-month projection ABOVE the
3-month flat baseline. The badge does NOT equal (projection − baseline) / 3.

---

## What Doesn't Work

- **Do NOT show slope × 30 as "$/month"** without qualification — users will try to multiply by 3
  to get the 3-month total increase and get a number 30× too small.
- **Do NOT show slope × 30 × 4.3 as "$/year"** — this double-counts: slope×30 is per month,
  then multiplying by 12 is correct for annual total change in daily rate, NOT annual revenue change.
- **Do NOT sum projections from day 0** — the projection total should start from today (day 395),
  not from the beginning of the dataset.
- **Do NOT use the regression line's y-value at day 395 as the "projection for month 1"** — that's
  a single-day point estimate. The month total requires summing all 30 days.
- **Do NOT confuse "change in monthly total" with "monthly total"** — the projected monthly total
  includes both the base revenue level AND the incremental growth.

---

## Gotchas

### The label/projection consistency trap
If you show "+$237/mo" on a badge AND show "Month 3 projected: $X", the user expects:
  `X ≈ current_monthly_revenue + 3 × 237`
But the correct math is `X ≈ current_monthly_revenue + 2.5 × 237` (because month 3's midpoint
is 2.5 months above the current midpoint, not 3.0). This is close enough to be fine.
However, if you use Interpretation A (slope × 30 = $7.91/month), the user expects
  `X ≈ current_monthly_revenue + 3 × 7.91 = current + $23.73`
which is completely wrong (off by 30×).

### Period conversion inconsistency
slope × 7 × 7 = $12.90/week, but $12.90 × 4.33 ≠ $237/month (it equals $55.85).
The correct monthly value (slope × 900 = $237) does NOT equal weekly value × 4.33.
This is because: `slope × 30² ≠ slope × 7² × (30/7)²` — they are equal actually.
Check: slope × 7² = $12.90, × (30/7)² = × 18.37 = $237. ✓
So the inconsistency in the original problem statement was from mixing Interpretation A and B:
- Interpretation A weekly: slope × 7 = $1.85
- Interpretation B weekly: slope × 49 = $12.90
- Interpretation B monthly: slope × 900 = $237
- $12.90/week × 4.33 = $55.85 ≠ $237/month
This residual inconsistency exists because 4.33 weeks/month is a ratio, but the periods are
not cleanly divisible: $12.90/week reflects a 7-day period, not a 30-day period.
The correct consistency check: `slope × 30² = slope × 7² × (30/7)²` ✓ (they are consistent)
The problem is just that "4.33 weeks in a month" does not preserve the period² relationship.

### Correct cross-period conversion for Interpretation B
```
weeklyTotalChange = slope × 7²  = slope × 49
monthlyTotalChange = slope × 30² = slope × 900
ratio = 900/49 ≈ 18.37  (NOT 4.33)
```
So "$12.90/week × 18.37 = $237/month" — consistent.

### Historical regression range matters
The intercept depends on what day index = 0 means. If day 0 = first data point:
- intercept = predicted revenue on day 0
- The "current daily revenue" = slope × 394 + intercept (for 395 days of data)
Always compute current_daily_avg = slope × (n-1) + intercept, not just intercept.

### Do not conflate trend with average
The current monthly average revenue = average of actual daily revenues over the last 30 days.
The regression-implied monthly total for "this month" = sum of 30 fitted values at the end of
the historical window. These are close but not identical (regression smooths over noise).
For projection display, use the regression-implied value for consistency with the trend line.

---

## Recommended Approach for Profit Duck

### Trend badge
Display: **"+$237/mo"** (Interpretation B: slope × days_in_period²)
Tooltip: "Daily revenue is trending up. At this rate, each month's total will be about $237 higher than the previous month."

### Projection calculation
```typescript
function projectRevenue(
  slope: number,
  intercept: number,
  historicalDays: number,  // = 395 (last day index = 394)
  projectionDays: number   // = 90 for 3 months
): number {
  // First projected day has index = historicalDays
  const startDay = historicalDays;
  const endDay = startDay + projectionDays - 1;
  const yStart = slope * startDay + intercept;
  const yEnd = slope * endDay + intercept;
  return projectionDays * (yStart + yEnd) / 2;
}
```

### Monthly breakdown display
For "3-month projection", show per-month totals:
```typescript
function monthlyProjections(
  slope: number,
  intercept: number,
  historicalDays: number,
  monthCount: number = 3,
  daysPerMonth: number = 30
): Array<{ month: number; projectedTotal: number }> {
  return Array.from({ length: monthCount }, (_, i) => {
    const startDay = historicalDays + i * daysPerMonth;
    const endDay = startDay + daysPerMonth - 1;
    const yStart = slope * startDay + intercept;
    const yEnd = slope * endDay + intercept;
    const projectedTotal = daysPerMonth * (yStart + yEnd) / 2;
    return { month: i + 1, projectedTotal };
  });
}
```

### Consistency check: badge vs projection
```
badge_monthly_growth = slope * 30 * 30  // = slope × 900
month1_total = projectRevenue(slope, intercept, 395, 30)
month2_total = projectRevenue(slope, intercept, 425, 30)
month2_total - month1_total ≈ badge_monthly_growth  // should match ✓
```
If the badge says "+$237/mo", then month2_total − month1_total should equal ~$237.

### Label guidance by period
| Period | Label | Formula | User reads as |
|--------|-------|---------|---------------|
| Daily | +$0.26/day | slope | Daily revenue grows $0.26 each day |
| Weekly | +$12.90/wk | slope × 49 | Each week's total is $12.90 more than last week |
| Monthly | +$237/mo | slope × 900 | Each month's total is $237 more than last month |
| Quarterly | +$2,183/qtr | slope × 8281 | Each quarter's total is $2,183 more than last quarter |
| Yearly | +$35,130/yr | slope × 133225 | Each year's total is $35,130 more than last year |

---

## Sources
- [Forecasting: Principles and Practice (3rd ed) — Ch. 7 Regression](https://otexts.com/fpp3/regression-intro.html)
- [Forecasting: Principles and Practice — Ch. 12.5 Prediction intervals for aggregates](https://otexts.com/fpp2/aggregates.html)
- [Linear trend model for forecasting — Duke University](https://people.duke.edu/~rnau/411trend.htm)
- [Predicting data trends — Microsoft Excel Support](https://support.microsoft.com/en-us/office/predict-data-trends-96a1d4be-5070-4928-85af-626fb5421a9a)
- [Excel FORECAST and related functions — AbleBits](https://www.ablebits.com/office-addins-blog/excel-forecast-function-formula-examples/)
- [Time Series Forecast — Aggregation for a forecasted period (Amazon QuickSight Community)](https://community.amazonquicksight.com/t/time-series-forecast-aggregation-for-a-forecasted-period/12358)
- [Forecasting: Principles and Practice — Simple forecasting methods](https://otexts.com/fpp2/simple-methods.html)
- [Chapter 2: Linear Trend and Momentum Forecasting — Time Series Analysis Handbook](https://phdinds-aim.github.io/time_series_handbook/02_LinearForecastingTrendandMomentumForecasting/02_LinearTrendandMomentumForecasting.html)
