import type { DailyPoint } from "./report";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ForecastPoint {
  date: string;
  t: number;
  /** Actual observed value (undefined for projected days). */
  actual?: number;
  /** Fitted/forecast value from the regression line. */
  forecast: number;
  /** Lower bound of the confidence band (>= 0). */
  lower: number;
  /** Upper bound of the confidence band. */
  upper: number;
}

export interface ForecastResult {
  points: ForecastPoint[];
  /** Slope in units per day. */
  slopePerDay: number;
  /** Daily run rate = average observed value per day. */
  dailyRunRate: number;
  /** R^2 goodness of fit, 0..1. */
  rSquared: number;
  /**
   * Approximate 95% half-width of day-to-day usage variability (critical value ×
   * residual standard error), constant per day and independent of the trend's
   * leverage. Useful as a spread band around a flat, user-asserted run rate.
   */
  dailyVariability: number;
  /** Total of actual observed values. */
  observedTotal: number;
  /** Projected total over the forecast horizon (forecast values only). */
  projectedTotal: number;
  /** Projected total +/- band over the horizon. */
  projectedLower: number;
  projectedUpper: number;
  /** Trend direction derived from the slope and noise. */
  trend: "rising" | "falling" | "flat";
  /** Number of observed days used. */
  observedDays: number;
  /** Number of projected days. */
  horizonDays: number;
}

interface Regression {
  intercept: number;
  slope: number;
  rSquared: number;
  /** Residual standard error. */
  se: number;
  meanX: number;
  sxx: number;
  n: number;
}

/** Ordinary least squares regression of value against day-index. */
function linearRegression(xs: number[], ys: number[]): Regression {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Residual sum of squares.
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i];
    const resid = ys[i] - predicted;
    ssRes += resid * resid;
  }

  const rSquared = syy === 0 ? 1 : Math.max(0, 1 - ssRes / syy);
  // Residual standard error (degrees of freedom = n - 2).
  const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

  return { intercept, slope, rSquared, se, meanX, sxx, n };
}

/** ~95% critical value; use 1.96 for large n, slightly wider for small samples. */
function criticalValue(n: number): number {
  if (n <= 2) return 4.3;
  if (n <= 5) return 2.8;
  if (n <= 10) return 2.3;
  if (n <= 30) return 2.05;
  return 1.96;
}

/**
 * Fit a linear trend to the daily series and project `horizonDays` into the future,
 * with an approximate 95% prediction band.
 */
export function forecastDaily(series: DailyPoint[], horizonDays = 30): ForecastResult | null {
  if (series.length < 2) return null;

  const startT = series[0].t;
  // x = day index relative to the first observed day.
  const xs = series.map((p) => Math.round((p.t - startT) / DAY_MS));
  const ys = series.map((p) => p.value);

  // The most recent day is usually incomplete (the report is pulled mid-day), so its
  // partial total would otherwise drag the fitted trend down and understate the run
  // rate. Exclude it from the regression when enough earlier days remain for a stable
  // fit (>= 3). It is still plotted as an actual and counted in observed totals.
  const excludeLast = series.length >= 4;
  const fitCount = excludeLast ? series.length - 1 : series.length;
  const fitXs = xs.slice(0, fitCount);
  const fitYs = ys.slice(0, fitCount);

  const reg = linearRegression(fitXs, fitYs);
  const crit = criticalValue(reg.n);

  const bandAt = (x: number): number => {
    if (reg.se === 0) return 0;
    // Prediction interval half-width for a new observation at x.
    const leverage = 1 + 1 / reg.n + (reg.sxx === 0 ? 0 : Math.pow(x - reg.meanX, 2) / reg.sxx);
    return crit * reg.se * Math.sqrt(leverage);
  };

  const points: ForecastPoint[] = [];

  // Observed range (fitted line + actuals).
  series.forEach((p, i) => {
    const x = xs[i];
    const fitted = reg.intercept + reg.slope * x;
    const band = bandAt(x);
    const value = Math.max(0, fitted);
    points.push({
      date: p.date,
      t: p.t,
      actual: p.value,
      forecast: fitted,
      lower: Math.max(0, fitted - band),
      upper: Math.max(value, fitted + band),
    });
  });

  // Projected future days.
  const lastX = xs[xs.length - 1];
  const lastT = series[series.length - 1].t;
  let projectedTotal = 0;
  let projectedLower = 0;
  let projectedUpper = 0;

  for (let d = 1; d <= horizonDays; d++) {
    const x = lastX + d;
    const t = lastT + d * DAY_MS;
    const fitted = reg.intercept + reg.slope * x;
    const band = bandAt(x);
    const value = Math.max(0, fitted);
    const lower = Math.max(0, fitted - band);
    // Daily usage (and therefore each band bound) can never be negative, so floor
    // the upper bound at the projected value to keep the cumulative total monotonic.
    const upper = Math.max(value, fitted + band);
    projectedTotal += value;
    projectedLower += lower;
    projectedUpper += upper;
    points.push({
      date: new Date(t).toISOString().slice(0, 10),
      t,
      forecast: value,
      lower,
      upper,
    });
  }

  const observedTotal = ys.reduce((a, b) => a + b, 0);
  // Run rate reflects a representative full day, so average over the fitted days
  // (which exclude the partial most-recent day when it was dropped above).
  const dailyRunRate = fitYs.reduce((a, b) => a + b, 0) / fitCount;

  // Trend: compare slope magnitude over the horizon against the noise level.
  const slopeOverHorizon = Math.abs(reg.slope) * horizonDays;
  const noise = reg.se || dailyRunRate * 0.05;
  let trend: ForecastResult["trend"] = "flat";
  if (slopeOverHorizon > noise) {
    trend = reg.slope > 0 ? "rising" : "falling";
  }

  return {
    points,
    slopePerDay: reg.slope,
    dailyRunRate,
    rSquared: reg.rSquared,
    dailyVariability: crit * reg.se,
    observedTotal,
    projectedTotal,
    projectedLower,
    projectedUpper,
    trend,
    observedDays: series.length,
    horizonDays,
  };
}

export interface SpikeDay {
  date: string;
  t: number;
  /** Observed value on this day. */
  value: number;
  /** Expected value from the fitted trend. */
  expected: number;
  /** Standardized residual (how many σ above the trend). */
  z: number;
  /** value / expected (capped, guards divide-by-zero). */
  ratio: number;
}

export interface SpikePoint {
  date: string;
  t: number;
  value: number;
  expected: number;
  /** Upper threshold line = expected + zThreshold·σ. */
  upper: number;
  isSpike: boolean;
}

export interface SpikeAnalysis {
  points: SpikePoint[];
  /** Spike days sorted by severity (z) descending. */
  spikes: SpikeDay[];
  /** Average value per day across the series. */
  baselineRunRate: number;
  /** Residual standard error of the trend fit. */
  se: number;
  /** z threshold used for flagging. */
  zThreshold: number;
}

/**
 * Flag days whose usage is anomalously high relative to the fitted linear trend.
 * A day is a spike when its value sits more than `zThreshold` residual standard
 * errors above the trend line. Returns null when there are too few days to
 * estimate residual variance reliably.
 */
export function detectSpikes(series: DailyPoint[], zThreshold = 2): SpikeAnalysis | null {
  if (series.length < 4) return null;

  const startT = series[0].t;
  const xs = series.map((p) => Math.round((p.t - startT) / DAY_MS));
  const ys = series.map((p) => p.value);

  const reg = linearRegression(xs, ys);
  // No residual variance (perfectly collinear) → nothing to flag.
  if (reg.se === 0) return null;

  const points: SpikePoint[] = [];
  const spikes: SpikeDay[] = [];

  series.forEach((p, i) => {
    const expected = reg.intercept + reg.slope * xs[i];
    const residual = p.value - expected;
    const z = residual / reg.se;
    const upper = expected + zThreshold * reg.se;
    const isSpike = residual > 0 && z >= zThreshold;
    points.push({
      date: p.date,
      t: p.t,
      value: p.value,
      expected: Math.max(0, expected),
      upper: Math.max(0, upper),
      isSpike,
    });
    if (isSpike) {
      spikes.push({
        date: p.date,
        t: p.t,
        value: p.value,
        expected: Math.max(0, expected),
        z,
        ratio: expected > 0 ? p.value / expected : Infinity,
      });
    }
  });

  spikes.sort((a, b) => b.z - a.z);

  const baselineRunRate = ys.reduce((a, b) => a + b, 0) / ys.length;

  return { points, spikes, baselineRunRate, se: reg.se, zThreshold };
}
