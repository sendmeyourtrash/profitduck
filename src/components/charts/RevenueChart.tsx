"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { linearRegression, movingAverage } from "@/lib/utils/statistics";

type Period = "1D" | "1W" | "1M" | "1Q";

interface DataPoint {
  date: string;
  total: number;
  count?: number;
}

interface SeasonalPoint {
  date: string;
  seasonal: number;
}

interface RevenueChartProps {
  data: DataPoint[];
  title?: string;
  showControls?: boolean;
  projectionDays?: number;
  // Seasonal projection
  seasonalProjectionPoints?: SeasonalPoint[];
  seasonalIndices?: Record<number, number>;
  seasonalOn?: boolean;
  onSeasonalToggle?: (on: boolean) => void;
  // Expense overlay (optional — daily expense totals keyed by date)
  expenseData?: DataPoint[];
  // Break-even reference line (daily amount needed to cover costs)
  breakEvenDaily?: number;
  // External control of trend/forecast (when managed by parent)
  externalShowTrend?: boolean;
  externalForecastRange?: "1m" | "3m" | "6m" | "1y" | "2y";
  // Callback when projection values change (for sidebar sync)
  onProjectionChange?: (info: {
    forecastLabel: string;
    projectedRevenue: number;
    trendRevenue: number;
    seasonalRevenue: number;
    unadjustedRevenue?: number;
    monthlyAvg?: number;
    isSeasonallyAdjusted: boolean;
    dailyTrend: string;
    confidence: string;
    r2: number;
    lookbackDays: number;
    seasonalCallout?: string;
    scenarios?: {
      worst: { trend: number; seasonal: number };
      mid: { trend: number; seasonal: number };
      best: { trend: number; seasonal: number };
    };
  }) => void;
  // Canonical daily regression from API (projection model)
  regressionSlope?: number;
  regressionIntercept?: number;
  regressionR2?: number;
  regressionStandardError?: number;
  chartLookbackDays?: number;
  // Closed day dates to optionally exclude from regression
  closedDates?: string[];
  // Default period when chart loads (e.g. "monthly" for expense trend)
  defaultPeriod?: "daily" | "weekly" | "monthly" | "quarterly";
}

// --- Period bucketing helpers ---

function bucketKey(dateStr: string, period: Period): string {
  if (period === "1D") return dateStr;
  const d = new Date(dateStr + "T12:00:00");
  if (period === "1W") {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }
  if (period === "1M") return dateStr.slice(0, 7);
  // 1Q
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}-Q${q}`;
}

function bucketLabel(key: string, period: Period): string {
  if (period === "1D") {
    // Always append T12:00:00 to prevent UTC midnight → prior day shift
    const d = new Date(key.length === 10 ? key + "T12:00:00" : key);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (period === "1W") {
    const d = new Date(key + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (period === "1M") {
    const [y, m] = key.split("-");
    const d = new Date(Number(y), Number(m) - 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return key; // 1Q: "2026-Q1"
}

function aggregateByPeriod(data: DataPoint[], period: Period): { key: string; label: string; total: number; count: number }[] {
  if (period === "1D") return data.map((d) => ({ key: d.date, label: "", total: d.total, count: d.count ?? 0 }));
  const buckets = new Map<string, { key: string; label: string; total: number; count: number }>();
  for (const d of data) {
    const k = bucketKey(d.date, period);
    let b = buckets.get(k);
    if (!b) { b = { key: k, label: bucketLabel(k, period), total: 0, count: 0 }; buckets.set(k, b); }
    b.total += d.total;
    b.count += d.count ?? 0;
  }
  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

const MA_WINDOW: Record<Period, number> = { "1D": 7, "1W": 4, "1M": 3, "1Q": 3 };
const PROJECTION_COUNT: Record<Period, number> = { "1D": 14, "1W": 4, "1M": 3, "1Q": 2 };
const PERIOD_UNIT: Record<Period, string> = { "1D": "day", "1W": "wk", "1M": "mo", "1Q": "qtr" };
const MA_LABEL: Record<Period, string> = { "1D": "7d MA", "1W": "4w MA", "1M": "3m MA", "1Q": "3q MA" };

export default function RevenueChart({
  data,
  title = "Revenue Trend",
  showControls = true,
  projectionDays,
  seasonalProjectionPoints,
  seasonalOn = false,
  onSeasonalToggle,
  seasonalIndices,
  expenseData,
  breakEvenDaily,
  externalShowTrend,
  externalForecastRange,
  onProjectionChange,
  regressionSlope,
  regressionIntercept,
  regressionR2,
  regressionStandardError,
  chartLookbackDays,
  closedDates,
  defaultPeriod,
}: RevenueChartProps) {
  const { theme } = useTheme();
  const gridStroke = theme === "dark" ? "#374151" : "#e5e7eb";
  const axisStroke = theme === "dark" ? "#4b5563" : "#9ca3af";

  const [internalShowTrend, setInternalShowTrend] = useState(false);
  const [showMA, setShowMA] = useState(false);
  const [showExpenses, setShowExpenses] = useState(false);
  const [showBreakEven, setShowBreakEven] = useState(false);
  const [excludeClosed, setExcludeClosed] = useState(false);
  const defaultPeriodMap: Record<string, Period> = { daily: "1D", weekly: "1W", monthly: "1M", quarterly: "1Q" };
  const [period, setPeriod] = useState<Period>(defaultPeriod ? defaultPeriodMap[defaultPeriod] || "1D" : "1D");
  const [internalForecastRange, setInternalForecastRange] = useState<"1m" | "3m" | "6m" | "1y" | "2y">("1m");

  // Use external state if provided, otherwise internal
  const showTrend = externalShowTrend ?? internalShowTrend;
  const forecastRange = externalForecastRange ?? internalForecastRange;

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

  const fmtAxis = (v: number): string => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return `$${v.toFixed(0)}`;
  };

  const formatDateLabel = (dateStr: string) => {
    if (period !== "1D") return dateStr; // already formatted by bucketLabel
    // Append T12:00:00 to prevent UTC midnight → prior day shift in US timezones
    const d = new Date(dateStr.length === 10 ? dateStr + "T12:00:00" : dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const FORECAST_DAYS: Record<string, number> = { "1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730 };

  const { chartData, trendSlope, trendLabel, r2, projectionPoints } = useMemo(() => {
    if (data.length === 0)
      return { chartData: [], trendSlope: 0, trendLabel: "", r2: 0, projectionPoints: [] as Record<string, unknown>[] };

    // --- Filter out closed days when toggle is on ---
    const closedSet = excludeClosed && closedDates ? new Set(closedDates) : null;
    const filteredData = closedSet
      ? data.filter((d) => !closedSet.has(d.date))
      : data;

    // --- Canonical daily regression (period-invariant) ---
    // When excluding closed days, always recompute from filtered data
    // Otherwise use API-provided params or regress on raw daily data
    const canonicalReg = (closedSet)
      ? linearRegression(filteredData.map((d, i) => ({ x: i, y: d.total })))
      : (regressionSlope != null && regressionIntercept != null)
        ? {
            slope: regressionSlope,
            intercept: regressionIntercept,
            r2: regressionR2 ?? 0,
            standardError: regressionStandardError ?? 0,
          }
        : linearRegression(data.map((d, i) => ({ x: i, y: d.total })));

    // --- Aggregate data by period for DISPLAY only ---
    const aggregated = aggregateByPeriod(filteredData, period);
    const maWindow = MA_WINDOW[period];

    // Build a map from bucket key → list of daily indices for trend line computation
    const bucketDayIndices = new Map<string, number[]>();
    for (let i = 0; i < filteredData.length; i++) {
      const k = bucketKey(filteredData[i].date, period);
      let arr = bucketDayIndices.get(k);
      if (!arr) { arr = []; bucketDayIndices.set(k, arr); }
      arr.push(i);
    }

    const displayData = aggregated.map((d) => ({
      date: period === "1D" ? d.key : d.label,
      key: d.key,
      total: d.total,
      count: d.count,
    }));

    // Compute moving average on aggregated data (visual aid, ok to be period-specific)
    const ma = movingAverage(
      displayData.map((d) => d.total),
      maWindow
    );

    // Build chart data — trend line is sum of daily trend values within each bucket
    const enriched: Record<string, unknown>[] = displayData.map((d, i) => {
      const dayIndices = bucketDayIndices.get(d.key);
      const bucketTrend = dayIndices
        ? dayIndices.reduce((sum, idx) => sum + (canonicalReg.slope * idx + canonicalReg.intercept), 0)
        : canonicalReg.slope * i + canonicalReg.intercept;
      return { ...d, trend: bucketTrend, ma: ma[i] };
    });

    // --- Projection: always day-by-day, then bucket for display ---
    const forecastDaysTotal = (showTrend || seasonalOn || onProjectionChange) ? FORECAST_DAYS[forecastRange] : 0;
    const lastDayIdx = filteredData.length - 1;
    const lastDate = filteredData.length > 0 ? new Date(filteredData[filteredData.length - 1].date + "T12:00:00") : new Date();

    // Compute daily projection values, then bucket into display periods
    const projBuckets = new Map<string, {
      label: string; trend: number; seasonal: number; days: number;
    }>();
    // Also accumulate raw daily totals for period-invariant sidebar
    let dailyTrendSum = 0;
    let dailySeasonalSum = 0;

    for (let j = 1; j <= forecastDaysTotal; j++) {
      const dayIdx = lastDayIdx + j;
      const trendVal = canonicalReg.slope * dayIdx + canonicalReg.intercept;
      dailyTrendSum += trendVal;

      // Seasonal factor for this future day
      const futureDate = new Date(lastDate);
      futureDate.setDate(futureDate.getDate() + j);
      const futureMonth = futureDate.getMonth() + 1;
      const factor = seasonalIndices ? (seasonalIndices[futureMonth] ?? 1.0) : 1.0;
      const seasonalVal = trendVal * factor;
      dailySeasonalSum += seasonalVal;

      // Determine which display bucket this day falls into
      const dateStr = futureDate.toISOString().slice(0, 10);
      const bk = bucketKey(dateStr, period);
      let bucket = projBuckets.get(bk);
      if (!bucket) {
        // Generate display label for this bucket
        let label: string;
        if (period === "1D") {
          label = dateStr;
        } else if (period === "1W") {
          const mon = new Date(bk + "T12:00:00");
          label = mon.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        } else if (period === "1M") {
          const [y, m] = bk.split("-");
          const d = new Date(Number(y), Number(m) - 1);
          label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        } else {
          label = bk; // "2026-Q2"
        }
        bucket = { label, trend: 0, seasonal: 0, days: 0 };
        projBuckets.set(bk, bucket);
      }
      bucket.trend += trendVal;
      bucket.seasonal += seasonalVal;
      bucket.days++;
    }

    // Convert bucketed projections to chart points
    const projectionPoints: Record<string, unknown>[] = [];
    const sortedBucketKeys = Array.from(projBuckets.keys()).sort();
    for (const bk of sortedBucketKeys) {
      const bucket = projBuckets.get(bk)!;
      projectionPoints.push({
        date: period === "1D" ? bk : bucket.label,
        key: bk,
        total: undefined,
        trend: bucket.trend,
        _seasonalCalc: bucket.seasonal,
        _standardError: canonicalReg.standardError,
        _dailyTrendSum: dailyTrendSum,
        _dailySeasonalSum: dailySeasonalSum,
        ...(seasonalOn ? { seasonal: bucket.seasonal } : {}),
        ma: undefined,
      });
    }

    // Extend chart with projection points when trend/seasonal is toggled
    if ((showTrend || seasonalOn) && projectionPoints.length > 0) {
      if (seasonalOn && displayData.length > 0) {
        (enriched[displayData.length - 1] as Record<string, unknown>).seasonal = displayData[displayData.length - 1].total;
      }
      enriched.push(...projectionPoints);
    }

    // Trend label — scale daily slope to the display period
    const PERIOD_MULTIPLIER: Record<Period, number> = { "1D": 1, "1W": 7, "1M": 30, "1Q": 90 };
    const scaledSlope = canonicalReg.slope * PERIOD_MULTIPLIER[period];
    const unit = PERIOD_UNIT[period];
    const absScaled = Math.abs(scaledSlope);
    const label = absScaled >= 1
      ? `${scaledSlope >= 0 ? "+" : "-"}$${absScaled.toFixed(0)}/${unit}`
      : `${scaledSlope >= 0 ? "+" : "-"}$${absScaled.toFixed(2)}/${unit}`;

    // Merge expense data if toggled on
    if (showExpenses && expenseData && expenseData.length > 0) {
      const expAgg = aggregateByPeriod(expenseData, period);
      const expMap = new Map(expAgg.map((e) => [e.key, e.total]));
      for (const row of enriched) {
        const key = (row as { key?: string }).key || (row as { date?: string }).date || "";
        const expVal = expMap.get(key);
        if (expVal !== undefined) {
          (row as Record<string, unknown>).expenses = expVal;
        }
      }
    }

    return { chartData: enriched, trendSlope: canonicalReg.slope, trendLabel: label, r2: canonicalReg.r2, projectionPoints };
  }, [data, period, showTrend, forecastRange, seasonalOn, seasonalProjectionPoints, seasonalIndices, showExpenses, expenseData, regressionSlope, regressionIntercept, regressionR2, regressionStandardError, excludeClosed, closedDates]);

  // Emit projection info to parent for sidebar sync
  const FORECAST_LABELS: Record<string, string> = { "1m": "Next 1 Month", "3m": "Next 3 Months", "6m": "Next 6 Months", "1y": "Next 1 Year", "2y": "Next 2 Years" };

  useEffect(() => {
    if (!onProjectionChange) return;

    // Use period-invariant daily sums stored in projection points
    // These are the same regardless of which display period is selected
    const firstProj = projectionPoints[0];
    const trendRevenue = firstProj ? (firstProj._dailyTrendSum as number) ?? 0 : 0;
    const seasonalRevenue = firstProj ? (firstProj._dailySeasonalSum as number) ?? 0 : 0;
    const projectedRevenue = seasonalOn ? seasonalRevenue : trendRevenue;

    // R² from canonical daily regression (period-invariant)
    const confLabel = r2 >= 0.7 ? `High (R²=${r2.toFixed(2)})`
      : r2 >= 0.4 ? `Moderate (R²=${r2.toFixed(2)})`
      : `Low (R²=${r2.toFixed(2)})`;

    // Monthly average
    const forecastMonths = FORECAST_DAYS[forecastRange] / 30;
    const monthlyAvg = forecastMonths > 0 ? Math.round((projectedRevenue / forecastMonths) * 100) / 100 : 0;

    // Seasonal callout
    let seasonalCallout: string | undefined;
    if (seasonalOn && seasonalIndices) {
      const now = new Date();
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const forecastDaysCount = FORECAST_DAYS[forecastRange];
      let worstMonth = 0, worstFactor = 2, bestMonth = 0, bestFactor = 0;
      for (let d = 1; d <= forecastDaysCount; d += 30) {
        const future = new Date(now);
        future.setDate(future.getDate() + d);
        const m = future.getMonth() + 1;
        const f = seasonalIndices[m] ?? 1.0;
        if (f < worstFactor) { worstFactor = f; worstMonth = m; }
        if (f > bestFactor) { bestFactor = f; bestMonth = m; }
      }
      if (worstFactor < 0.9) {
        const pct = Math.round((1 - worstFactor) * 100);
        seasonalCallout = `${monthNames[worstMonth - 1]} typically ${pct}% below average — expect a dip`;
      } else if (bestFactor > 1.1) {
        const pct = Math.round((bestFactor - 1) * 100);
        seasonalCallout = `${monthNames[bestMonth - 1]} typically ${pct}% above average — expect a bump`;
      }
    }

    // Scenarios using canonical standard error (period-invariant)
    const forecastDaysCount = FORECAST_DAYS[forecastRange] || 90;
    const se = firstProj?._standardError != null
      ? (firstProj._standardError as number)
      : 0;
    const errorMargin = se * Math.sqrt(forecastDaysCount);

    // Compute seasonal error margin using average seasonal factor over forecast period
    // This avoids the ratio blowup when trendRevenue is near zero
    const avgSeasonalFactor = trendRevenue !== 0 ? seasonalRevenue / trendRevenue : 1;
    const seasonalErrorMargin = Math.abs(errorMargin * (Math.abs(avgSeasonalFactor) > 5 ? 1 : avgSeasonalFactor));

    const scenarios = {
      worst: {
        trend: Math.round((trendRevenue - errorMargin) * 100) / 100,
        seasonal: Math.round((seasonalRevenue - seasonalErrorMargin) * 100) / 100,
      },
      mid: {
        trend: Math.round(trendRevenue * 100) / 100,
        seasonal: Math.round(seasonalRevenue * 100) / 100,
      },
      best: {
        trend: Math.round((trendRevenue + errorMargin) * 100) / 100,
        seasonal: Math.round((seasonalRevenue + seasonalErrorMargin) * 100) / 100,
      },
    };

    onProjectionChange({
      forecastLabel: FORECAST_LABELS[forecastRange] || forecastRange,
      projectedRevenue: Math.round(projectedRevenue * 100) / 100,
      trendRevenue: Math.round(trendRevenue * 100) / 100,
      seasonalRevenue: Math.round(seasonalRevenue * 100) / 100,
      unadjustedRevenue: seasonalOn ? Math.round(trendRevenue * 100) / 100 : undefined,
      monthlyAvg,
      isSeasonallyAdjusted: seasonalOn,
      dailyTrend: trendLabel,
      confidence: confLabel,
      r2,
      lookbackDays: chartLookbackDays ?? data.length,
      seasonalCallout,
      scenarios,
    });
  }, [projectionPoints, forecastRange, seasonalOn, showTrend, r2, trendLabel, onProjectionChange, seasonalIndices, chartLookbackDays, data.length]);

  const hasExpenses = showExpenses && expenseData && expenseData.length > 0;
  const hasBreakEven = showBreakEven && breakEvenDaily != null && breakEvenDaily > 0;
  const beMultiplier = period === "1W" ? 7 : period === "1M" ? 30 : period === "1Q" ? 90 : 1;
  const beValue = (breakEvenDaily ?? 0) * beMultiplier;
  const beLabel = period === "1D" ? `$${Math.round(beValue)}/day`
    : period === "1W" ? `$${Math.round(beValue)}/wk`
    : period === "1M" ? `$${Math.round(beValue)}/mo`
    : `$${Math.round(beValue)}/qtr`;
  const hasOverlay = showTrend || showMA || seasonalOn || hasExpenses;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-6">
      {/* Title row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h3>
          {showTrend && data.length > 1 && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                trendSlope >= 0
                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
              }`}
            >
              {trendLabel}
            </span>
          )}
        </div>
        {showControls && (
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          >
            <option value="1D">Daily</option>
            <option value="1W">Weekly</option>
            <option value="1M">Monthly</option>
            <option value="1Q">Quarterly</option>
          </select>
        )}
      </div>

      {/* Overlay toggles row — hide Trend/Seasonal/Forecast when externally controlled */}
      {showControls && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {/* Forecast group: Trend + Seasonal */}
          {(externalShowTrend == null || (onSeasonalToggle && externalShowTrend == null)) && (
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              {externalShowTrend == null && (
                <button
                  onClick={() => setInternalShowTrend((p) => !p)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                    showTrend ? "bg-white dark:bg-gray-600 text-indigo-600 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  Trend
                </button>
              )}
              {onSeasonalToggle && externalShowTrend == null && (
                <button
                  onClick={() => onSeasonalToggle(!seasonalOn)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                    seasonalOn ? "bg-white dark:bg-gray-600 text-violet-600 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  Seasonal
                </button>
              )}
            </div>
          )}
          {externalForecastRange == null && (showTrend || seasonalOn) && (
            <select
              value={forecastRange}
              onChange={(e) => setInternalForecastRange(e.target.value as typeof internalForecastRange)}
              className="text-[11px] border border-gray-200 dark:border-gray-600 rounded-md px-1.5 py-0.5 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              <option value="1m">Forecast 1m</option>
              <option value="3m">Forecast 3m</option>
              <option value="6m">Forecast 6m</option>
              <option value="1y">Forecast 1y</option>
              <option value="2y">Forecast 2y</option>
            </select>
          )}

          {/* Overlay group: MA + Expenses + Break-even */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => setShowMA((p) => !p)}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                showMA ? "bg-white dark:bg-gray-600 text-indigo-600 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {MA_LABEL[period]}
            </button>
            {expenseData && expenseData.length > 0 && (
              <button
                onClick={() => setShowExpenses((p) => !p)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                  showExpenses ? "bg-white dark:bg-gray-600 text-red-600 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Expenses
              </button>
            )}
            {breakEvenDaily != null && breakEvenDaily > 0 && (
              <button
                onClick={() => setShowBreakEven((p) => !p)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                  showBreakEven ? "bg-white dark:bg-gray-600 text-amber-600 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Break-even
              </button>
            )}
          </div>
          {closedDates && closedDates.length > 0 && (
            <button
              onClick={() => setExcludeClosed((p) => !p)}
              className={`px-2 py-0.5 text-[11px] font-medium rounded-lg transition-colors ${
                excludeClosed ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Excl. closed
            </button>
          )}
        </div>
      )}

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              tick={{ fontSize: 12 }}
              stroke={axisStroke}
            />
            <YAxis
              tickFormatter={fmtAxis}
              tick={{ fontSize: 11 }}
              stroke={axisStroke}
              width={55}
              tickCount={6}
              domain={hasBreakEven ? [0, (dataMax: number) => Math.max(dataMax, beValue * 1.1)] : undefined}
            />
            <Tooltip
              formatter={(value, name) => {
                if (value == null) return ["-", ""];
                const label =
                  name === "total"
                    ? "Revenue"
                    : name === "expenses"
                      ? "Expenses"
                      : name === "trend"
                        ? "Trendline"
                        : name === "ma"
                          ? MA_LABEL[period]
                          : name === "seasonal"
                            ? "Seasonal Forecast"
                            : String(name);
                return [formatCurrency(Number(value)), label];
              }}
              labelFormatter={(label) => formatDateLabel(String(label))}
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke="#6366f1"
              fill="url(#colorRevenue)"
              strokeWidth={2}
              connectNulls={false}
            />
            {hasExpenses && (
              <Area
                type="monotone"
                dataKey="expenses"
                stroke="#ef4444"
                fill="url(#colorExpenses)"
                strokeWidth={1.5}
                connectNulls={false}
              />
            )}
            {hasBreakEven && (
              <ReferenceLine
                key={`be-${period}-${beValue}`}
                y={beValue}
                stroke="#f59e0b"
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `Break-even ${beLabel}`, position: "insideTopRight", fontSize: 10, fill: "#d97706" }}
              />
            )}
            {showTrend && (
              <Line
                type="monotone"
                dataKey="trend"
                stroke="#9ca3af"
                strokeWidth={2}
                strokeDasharray="8 4"
                dot={false}
                connectNulls
              />
            )}
            {showMA && (
              <Line
                type="monotone"
                dataKey="ma"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={false}
                connectNulls={false}
              />
            )}
            {seasonalOn && onSeasonalToggle && (
              <Line
                type="monotone"
                dataKey="seasonal"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                connectNulls={false}
              />
            )}
            {hasOverlay && (
              <Legend
                formatter={(value) =>
                  value === "total"
                    ? "Revenue"
                    : value === "expenses"
                      ? "Expenses"
                      : value === "trend"
                        ? "Trendline"
                        : value === "ma"
                          ? MA_LABEL[period]
                          : value === "seasonal"
                            ? "Seasonal Forecast"
                            : value
                }
                iconType="line"
                wrapperStyle={{ fontSize: 11 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
