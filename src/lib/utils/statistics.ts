/**
 * Least-squares linear regression.
 * Takes an array of {x, y} points, returns slope, intercept, and R² value.
 */
export function linearRegression(
  points: { x: number; y: number }[]
): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };

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
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² (coefficient of determination)
  const meanY = sumY / n;
  let ssTot = 0,
    ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (slope * x + intercept)) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
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
}

export function computeSeasonalIndices(
  samples: MonthlyRevenueSample[]
): Record<number, number> {
  const buckets: Record<number, number[]> = {};
  for (let m = 1; m <= 12; m++) buckets[m] = [];

  for (const s of samples) {
    if (s.month >= 1 && s.month <= 12) {
      buckets[s.month].push(s.total);
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
