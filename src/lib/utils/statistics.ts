/**
 * Least-squares linear regression.
 * Takes an array of {x, y} points, returns slope, intercept, and R² value.
 */
export function linearRegression(
  points: { x: number; y: number }[]
): { slope: number; intercept: number; r2: number; standardError: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0, standardError: 0 };

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;

  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0, standardError: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² (coefficient of determination) + standard error of residuals
  const meanY = sumY / n;
  let ssTot = 0,
    ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (slope * x + intercept)) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Standard error of the estimate (root mean square error)
  const standardError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

  return { slope, intercept, r2, standardError };
}

/**
 * Compute multiplicative seasonal indices for each calendar month (1-12).
 * A value of 1.0 means that month is average. 1.3 = 30% above average, 0.8 = 20% below.
 *
 * Input: one entry per (year, month) pair from historical data.
 * Groups by month, computes mean per month, divides by grand mean.
 * Months with no data default to 1.0 (neutral).
 */
export interface MonthlyRevenueSample {
  month: number; // 1-12
  total: number;
  trendTotal?: number; // expected total from regression (for detrending)
}

/**
 * Monthly seasonal indices using ratio-to-trend detrending.
 * If trendTotal is provided, each sample is detrended (actual/trend) before averaging.
 * This prevents growth trends from being confused with seasonality.
 * Returns Record<1..12, number> where 1=January.
 */
export function computeSeasonalIndices(
  samples: MonthlyRevenueSample[]
): Record<number, number> {
  const buckets: Record<number, number[]> = {};
  for (let m = 1; m <= 12; m++) buckets[m] = [];

  for (const s of samples) {
    if (s.month >= 1 && s.month <= 12) {
      // If trend is available, use ratio-to-trend; otherwise use raw total
      const value = s.trendTotal && s.trendTotal > 0 ? s.total / s.trendTotal : s.total;
      buckets[s.month].push(value);
    }
  }

  const monthMeans: Record<number, number> = {};
  let nonEmptyCount = 0;
  let grandSum = 0;

  for (let m = 1; m <= 12; m++) {
    if (buckets[m].length > 0) {
      const mean = buckets[m].reduce((a, b) => a + b, 0) / buckets[m].length;
      monthMeans[m] = mean;
      grandSum += mean;
      nonEmptyCount++;
    }
  }

  const grandMean = nonEmptyCount > 0 ? grandSum / nonEmptyCount : 1;

  const indices: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    indices[m] = monthMeans[m] != null ? monthMeans[m] / grandMean : 1.0;
  }
  return indices;
}

export interface DowRevenueSample {
  dow: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  total: number;
  trendTotal?: number; // expected total from regression (for detrending)
}

/**
 * Day-of-week seasonal indices using ratio-to-trend detrending.
 * If trendTotal is provided, each sample is detrended (actual/trend) before averaging.
 * Returns Record<0..6, number> where 0=Sunday.
 */
export function computeDowIndices(
  samples: DowRevenueSample[]
): Record<number, number> {
  const buckets: Record<number, number[]> = {};
  for (let d = 0; d <= 6; d++) buckets[d] = [];

  for (const s of samples) {
    if (s.dow >= 0 && s.dow <= 6) {
      const value = s.trendTotal && s.trendTotal > 0 ? s.total / s.trendTotal : s.total;
      buckets[s.dow].push(value);
    }
  }

  const dowMeans: Record<number, number> = {};
  let nonEmptyCount = 0;
  let grandSum = 0;

  for (let d = 0; d <= 6; d++) {
    if (buckets[d].length > 0) {
      const mean = buckets[d].reduce((a, b) => a + b, 0) / buckets[d].length;
      dowMeans[d] = mean;
      grandSum += mean;
      nonEmptyCount++;
    }
  }

  const grandMean = nonEmptyCount > 0 ? grandSum / nonEmptyCount : 1;

  const indices: Record<number, number> = {};
  for (let d = 0; d <= 6; d++) {
    indices[d] = dowMeans[d] != null ? dowMeans[d] / grandMean : 1.0;
  }
  return indices;
}

/**
 * Simple moving average.
 * Returns an array the same length as input. Early values use partial windows.
 */
export function movingAverage(values: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = values.slice(start, i + 1);
    result.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  return result;
}
