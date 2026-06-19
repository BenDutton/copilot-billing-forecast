"use client";

import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Heading, Text, Label, TextInput, Tooltip as PrimerTooltip, IconButton, Button } from "@primer/react";
import {
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  DashIcon,
  InfoIcon,
} from "@primer/octicons-react";
import { useReport } from "@/components/report-provider";
import { usePrefersReducedMotion } from "@/components/use-prefers-reduced-motion";
import { ExportMenu } from "@/components/export-menu";
import { usePersistentState } from "@/components/use-persistent-state";
import { aggregateDaily, sumMetric } from "@/lib/report";
import { forecastDaily } from "@/lib/forecast";
import styles from "../app.module.css";

/** 1 AI Credit (AIC) = $0.01 USD. */
const USD_PER_AIC = 0.01;

/** Accent colour for the drag-to-select range (matches the "Observed" series). */
const SELECTION_COLOR = "#0969da";

/** Series colours. The grey baseline always tracks the data-driven trend; the
 * coloured line is the projection (the observed trend, or your scenario rate). */
const FORECAST_COLOR = "#8250df"; // projection / scenario run-rate line
const BASELINE_COLOR = "#57606a"; // data-driven baseline shown for comparison

/**
 * Days from the last observed day through the end of that calendar month.
 * GitHub AI Credit entitlements reset monthly, so the forecast runs to month-end.
 */
function daysToMonthEnd(lastDay: string): number {
  const [y, m, d] = lastDay.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastOfMonth - d);
}

const TREND_META = {
  rising: { label: "Rising", variant: "danger", Icon: ArrowUpRightIcon },
  falling: { label: "Falling", variant: "success", Icon: ArrowDownRightIcon },
  flat: { label: "Flat", variant: "secondary", Icon: DashIcon },
} as const;

/** A drag-selected span on the cumulative chart. */
interface RangeSelection {
  /** ISO date at the start (earlier edge) of the span. */
  startDate: string;
  /** Cumulative AIC at the start of the span. */
  startValue: number;
  /** Net AIC consumed across the span (endValue - startValue). */
  delta: number;
  /** Whole days covered by the span. */
  days: number;
}

export function UsageForecast() {
  const { report } = useReport();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [entitlementInput, setEntitlementInput] = usePersistentState(
    "usage-forecast:entitlement",
  );
  // What-if scenario: the daily run rate (AIC/day) to project from today onward.
  // Blank means "use the trend-fitted rate". The percentage slider and the exact
  // input below are two views of this single value.
  const [scenarioRateInput, setScenarioRateInput] = usePersistentState(
    "usage-forecast:scenario-rate",
  );
  const chartRef = useRef<HTMLDivElement>(null);

  // Drag-to-select range on the chart. `selStart`/`selEnd` hold the date labels
  // at the edges of the dragged span; `selecting` is true mid-drag.
  const [selecting, setSelecting] = useState(false);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);

  const entitlement = Math.max(0, Number(entitlementInput) || 0);
  // Parsed scenario run rate, or null when the field is blank/non-numeric (project
  // at the fitted trend). A set value projects a flat daily rate from today onward.
  const parsedScenarioRate = Number(scenarioRateInput);
  const scenarioRate =
    scenarioRateInput.trim() === "" || !Number.isFinite(parsedScenarioRate)
      ? null
      : Math.max(0, parsedScenarioRate);

  // AI Credits are reported in the `quantity` field of the AI usage report.
  const daily = useMemo(
    () => (report ? aggregateDaily(report.rows, "quantity") : []),
    [report],
  );

  const forecast = useMemo(() => {
    if (!daily.length) return null;
    const horizon = daysToMonthEnd(daily[daily.length - 1].date);
    return forecastDaily(daily, horizon);
  }, [daily]);

  // Cumulative running total of AI Credits - observed days, then projected with band.
  // The projection applies the what-if multiplier; a grey baseline tracks the
  // unadjusted trend for comparison.
  const cumulativeData = useMemo(() => {
    if (!forecast) return [];
    const obs = forecast.observedDays;
    let runA = 0;
    let runF = 0;
    let runL = 0;
    let runU = 0;
    let runBase = 0;
    let seed = 0;
    return forecast.points.map((p, i) => {
      if (i < obs) {
        runA += p.actual ?? 0;
        seed = runA;
        // The dashed projection/baseline lines and the band only render from
        // "today" (the last observed day) onward, anchored there so they join the
        // solid observed line. `forecast` stays populated on every day because the
        // drag-to-select range reads it as the cumulative running total.
        const anchor = i === obs - 1;
        return {
          date: p.date,
          actual: round2(runA),
          forecast: round2(runA),
          baseline: round2(runA),
          forecastLine: anchor ? round2(runA) : null,
          baselineLine: anchor ? round2(runA) : null,
          band: anchor ? ([round2(runA), round2(runA)] as [number, number]) : null,
        };
      }
      if (i === obs) {
        runF = seed;
        runL = seed;
        runU = seed;
        runBase = seed;
      }
      // When a scenario rate is set, project from that flat daily rate the user has
      // asserted. The regression's prediction band no longer applies, so the spread
      // shown is instead the historical day-to-day variability (constant per day).
      const base = scenarioRate ?? p.forecast;
      const lowerHalf = scenarioRate != null ? forecast.dailyVariability : p.forecast - p.lower;
      const upperHalf = scenarioRate != null ? forecast.dailyVariability : p.upper - p.forecast;
      runF += base;
      runL += Math.max(0, base - lowerHalf);
      runU += base + upperHalf;
      runBase += p.forecast;
      return {
        date: p.date,
        actual: null,
        forecast: round2(runF),
        baseline: round2(runBase),
        forecastLine: round2(runF),
        baselineLine: round2(runBase),
        band: [round2(runL), round2(runU)] as [number, number],
      };
    });
  }, [forecast, scenarioRate]);

  // Summary of the dragged range: the cumulative AIC consumed between the two
  // selected dates (the `forecast` series carries the running total for both
  // observed and projected days), with the span length in days.
  const selection = useMemo<RangeSelection | null>(() => {
    if (!selStart || !selEnd || !cumulativeData.length) return null;
    const iA = cumulativeData.findIndex((d) => d.date === selStart);
    const iB = cumulativeData.findIndex((d) => d.date === selEnd);
    if (iA === -1 || iB === -1 || iA === iB) return null;
    const [lo, hi] = iA <= iB ? [iA, iB] : [iB, iA];
    const startVal = cumulativeData[lo].forecast ?? 0;
    const endVal = cumulativeData[hi].forecast ?? 0;
    return {
      startDate: cumulativeData[lo].date,
      startValue: startVal,
      delta: endVal - startVal,
      days: hi - lo,
    };
  }, [selStart, selEnd, cumulativeData]);

  type ChartMouseState = { activeLabel?: string | number } | null | undefined;

  function beginSelect(e: ChartMouseState) {
    const label = e?.activeLabel;
    if (label == null) return;
    setSelecting(true);
    setSelStart(String(label));
    setSelEnd(String(label));
  }

  function extendSelect(e: ChartMouseState) {
    if (!selecting) return;
    const label = e?.activeLabel;
    if (label == null) return;
    setSelEnd(String(label));
  }

  function endSelect() {
    setSelecting(false);
    // A click without a drag (start === end) clears any prior selection.
    if (selStart && selEnd && selStart === selEnd) {
      setSelStart(null);
      setSelEnd(null);
    }
  }

  // First day (observed or projected) on which the cumulative total reaches the
  // entitlement, with the gap measured from today. The React Compiler memoizes
  // this automatically.
  let capCross: { date: string; daysOut: number } | null = null;
  if (entitlement > 0) {
    for (let i = 0; i < cumulativeData.length; i++) {
      if ((cumulativeData[i].forecast ?? 0) >= entitlement) {
        const date = cumulativeData[i].date;
        capCross = { date, daysOut: daysFromToday(date) };
        break;
      }
    }
  }

  const lastActualDate = daily.length ? daily[daily.length - 1].date : null;

  if (!report) return null;

  if (!forecast) {
    return (
      <div className={styles.card}>
        <Heading as="h2" style={{ fontSize: 20, marginBottom: 4 }}>
          Not enough data
        </Heading>
        <Text as="p" className={styles.muted}>
          At least two distinct days of AI Credit usage are required to build a forecast.
          Try a report with a wider date range.
        </Text>
      </div>
    );
  }

  const trend = TREND_META[forecast.trend];
  const observed = sumMetric(report.rows, "quantity");

  // The forecast horizon runs to month-end, so the final point is the last day of the month.
  const monthEndDate = forecast.points[forecast.points.length - 1]?.date ?? lastActualDate;
  const monthEndLabel = monthEndDate ? formatMonthEnd(monthEndDate) : "month end";
  // The fitted run rate is the baseline; a scenario asserts a different flat rate.
  const baselineRate = forecast.dailyRunRate;
  const isScenario = scenarioRate != null;
  // Percentage change of the scenario rate versus the fitted baseline, used by the
  // slider. Both the slider and the exact input map back to `scenarioRate`.
  const scenarioPct =
    isScenario && baselineRate > 0 ? Math.round((scenarioRate / baselineRate - 1) * 100) : 0;
  // Slider position, clamped to its range even if an exact value implies more.
  const sliderPct = Math.max(-100, Math.min(100, scenarioPct));

  // End-of-horizon projected cumulative total (AIC) and its band, taken from the
  // last cumulative point so the scenario run rate flows through. `baselineEnd` is
  // the unadjusted trend projection for comparison.
  const lastCumulative = cumulativeData[cumulativeData.length - 1];
  const projectedEnd = lastCumulative?.forecast ?? forecast.observedTotal;
  const [projectedEndLower, projectedEndUpper] = lastCumulative?.band ?? [
    projectedEnd,
    projectedEnd,
  ];
  const baselineEnd = lastCumulative?.baseline ?? forecast.observedTotal;
  const scenarioDelta = projectedEnd - baselineEnd;
  const adjustedRate = scenarioRate ?? baselineRate;
  const projectionLabel = isScenario ? "Scenario" : "Forecast";

  const overageAic = entitlement > 0 ? Math.max(0, projectedEnd - entitlement) : 0;
  const overageUsd = overageAic * USD_PER_AIC;

  const exportStats = [
    { label: "Observed total", value: formatAic(observed), sub: `${forecast.observedDays} days` },
    {
      label: isScenario ? "Scenario run rate" : "Daily run rate",
      value: `${formatAic(adjustedRate)}/day`,
    },
    {
      label: isScenario ? "Scenario month total" : "Projected month total",
      value: formatAic(projectedEnd),
      sub: `${formatAic(projectedEndLower)} – ${formatAic(projectedEndUpper)}`,
    },
    ...(entitlement > 0
      ? [
          {
            label: "Entitlement",
            value: formatAic(entitlement),
            sub: overageAic > 0 ? `Overage ${formatAic(overageAic)}` : "Within entitlement",
          },
        ]
      : [{ label: "Trend", value: trend.label, sub: `R² ${forecast.rSquared.toFixed(2)}` }]),
  ];

  const chartAnim = {
    isAnimationActive: !prefersReducedMotion,
    animationDuration: 600,
    animationEasing: "ease-out" as const,
  };

  return (
    <div className={styles.stack}>
      {/* Controls */}
      <div className={styles.controlsRow}>
        <Label variant="accent">Projection through {monthEndLabel}</Label>
        <div className={styles.controlsGroup}>
          <div className={styles.sliderField}>
            <span className={styles.labelWithInfo} style={{ fontSize: 12, fontWeight: 600 }}>
              Projected daily run rate
              <InfoTip text="What-if: set the daily run rate used for the projection from today onward. Adjust by percentage relative to the fitted rate, or enter an exact figure - the two stay in sync. Leave at the fitted rate to project the observed trend." />
            </span>
            <div className={styles.fieldRow}>
              <div className={styles.sliderControl}>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={5}
                  value={sliderPct}
                  onChange={(e) => {
                    const pct = Number(e.target.value);
                    setScenarioRateInput(
                      pct === 0 ? "" : String(round2(baselineRate * (1 + pct / 100))),
                    );
                  }}
                  aria-label="Run-rate change percentage"
                />
                <span className={styles.sliderValue}>
                  <Label variant={scenarioPct === 0 ? "secondary" : scenarioPct < 0 ? "success" : "danger"}>
                    {scenarioPct > 0 ? "+" : ""}
                    {scenarioPct}%
                  </Label>
                </span>
              </div>
              <TextInput
                type="number"
                min={0}
                placeholder={`${Math.round(baselineRate)}`}
                value={scenarioRateInput}
                onChange={(e) => setScenarioRateInput(e.target.value)}
                trailingVisual="AIC/day"
                style={{ width: 150 }}
                aria-label="Daily run rate"
              />
              <Button
                variant="invisible"
                size="small"
                onClick={() => setScenarioRateInput("")}
                disabled={!isScenario}
              >
                Reset
              </Button>
            </div>
            <span className={styles.fieldHint}>
              {isScenario
                ? `Projecting at ${formatAic(scenarioRate)}/day (${scenarioPct > 0 ? "+" : ""}${scenarioPct}% vs the fitted ${formatAic(baselineRate)}/day).`
                : `Projecting at the fitted ${formatAic(baselineRate)}/day - adjust the slider or enter a rate to model a different one.`}
            </span>
          </div>
          <div className={styles.sliderField}>
            <span className={styles.labelWithInfo} style={{ fontSize: 12, fontWeight: 600 }}>
              AI Credit entitlement
              <InfoTip text="Your monthly AI Credit allowance. Shown as a dotted cap line on the chart. 1 AIC = $0.01 USD, so any projected overage is also priced in USD." />
            </span>
            <div className={styles.fieldRow}>
              <TextInput
                type="number"
                min={0}
                placeholder="e.g. 3900"
                value={entitlementInput}
                onChange={(e) => setEntitlementInput(e.target.value)}
                trailingVisual="AIC"
                style={{ width: 240 }}
              />
              <Button
                variant="invisible"
                size="small"
                onClick={() => setEntitlementInput("")}
                disabled={!entitlementInput}
              >
                Reset
              </Button>
            </div>
            <span className={styles.fieldHint}>
              {entitlement > 0
                ? `Cap line shown on the chart at ${formatAic(entitlement)} AIC.`
                : "Add your allowance to see the cap line and any overage."}
            </span>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className={styles.statGrid}>
        <StatCard
          title="Observed total"
          info="Total AI Credits already consumed in the uploaded report, summed across all rows."
          value={formatAic(observed)}
          sub={`${forecast.observedDays} days · ${formatUsd(observed * USD_PER_AIC)}`}
        />
        <StatCard
          title="Daily run rate"
          info="Average AI Credits consumed per day, derived from the trend line fitted to your usage. The most recent day is often incomplete, so it is left out of the trend fit (it still counts toward the observed total). With a scenario run rate set, this shows that rate instead."
          value={`${formatAic(isScenario ? adjustedRate : forecast.dailyRunRate)}/day`}
          sub={
            isScenario
              ? `Baseline ${formatAic(forecast.dailyRunRate)}/day`
              : `${formatUsd(forecast.dailyRunRate * USD_PER_AIC)}/day`
          }
        />
        <StatCard
          title={isScenario ? "Scenario month total" : "Projected month total"}
          info="Estimated cumulative AI Credits by the end of the current month. The range is an approximate 95% band: the trend's prediction interval, or expected day-to-day variability when you set a scenario rate."
          value={formatAic(projectedEnd)}
          sub={`${formatAic(projectedEndLower)} – ${formatAic(projectedEndUpper)}`}
          extra={
            <>
              <span
                style={{
                  display: "block",
                  visibility: isScenario ? "visible" : "hidden",
                  color:
                    scenarioDelta < 0
                      ? "var(--fgColor-success, #1a7f37)"
                      : "var(--fgColor-danger, #cf222e)",
                  fontWeight: 600,
                }}
              >
                {scenarioDelta < 0 ? "−" : "+"}
                {formatAic(Math.abs(scenarioDelta))} vs baseline
              </span>
              {entitlement > 0 &&
                (overageAic > 0 ? (
                  <span
                    style={{ display: "block", color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }}
                  >
                    Overage: {formatAic(overageAic)} ({formatUsd(overageUsd)})
                  </span>
                ) : (
                  <span
                    style={{ display: "block", color: "var(--fgColor-success, #1a7f37)", fontWeight: 600 }}
                  >
                    Within entitlement
                  </span>
                ))}
            </>
          }
        />
        {entitlement > 0 ? (
          <StatCard
            title="Entitlement outlook"
            info="When your cumulative usage is projected to reach the entitlement, counted from today based on the current run rate."
            value={
              capCross
                ? capCross.daysOut <= 0
                  ? "Reached"
                  : `~${capCross.daysOut} ${capCross.daysOut === 1 ? "day" : "days"}`
                : "Within cap"
            }
            sub={
              capCross
                ? capCross.daysOut <= 0
                  ? `${formatAic(entitlement)} already reached on ${capCross.date}`
                  : `Reaches ${formatAic(entitlement)} on ${capCross.date}`
                : `Stays under ${formatAic(entitlement)} this month`
            }
          />
        ) : (
          <div className={styles.card}>
            <div className={styles.cardLabel}>
              <span className={styles.labelWithInfo}>
                Trend &amp; fit
                <InfoTip text="Direction of your usage trend, plus how well the straight line fits the data. R² ranges 0–1: closer to 1 means a more reliable forecast." />
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <Label variant={trend.variant}>
                <trend.Icon size={14} />
                <span style={{ marginLeft: 4 }}>{trend.label}</span>
              </Label>
            </div>
            <div className={styles.statSub}>
              R² {forecast.rSquared.toFixed(2)} · slope {formatAic(forecast.slopePerDay)}/day
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.cardHeaderRow}>
          <div>
            <span className={styles.labelWithInfo}>
              <Heading as="h2" style={{ fontSize: 16 }}>
                Cumulative AI Credits this month
              </Heading>
              <InfoTip text="The projection fits a linear regression to your daily usage and extends it to month-end. The shaded band is an approximate 95% prediction interval: it widens with day-to-day variability and the further it projects, and is floored at zero. When you set a scenario run rate, the band instead shows expected day-to-day variability (about a 95% spread) around that flat rate. The most recent (partial) day is excluded from the fit so it doesn't drag the trend down." />
            </span>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Solid line is observed usage; the dashed line is{" "}
              {isScenario
                ? "your scenario run rate, with a band for expected day-to-day variability, versus the grey baseline trend"
                : "the projected trend with an approximate 95% confidence band"}
              {entitlement > 0 ? "; the red dotted line is your entitlement" : ""}.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <Label variant="accent">{report.reportType.toUpperCase()} report</Label>
            <ExportMenu
              chartRef={chartRef}
              title="Usage Forecast"
              subtitle="Cumulative AI Credits this month"
              stats={exportStats}
            />
          </div>
        </div>

        <div className={styles.chartWrap} ref={chartRef}>
          <ResponsiveContainer initialDimension={{ width: 600, height: 300 }}>
            <ComposedChart
              data={cumulativeData}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              onMouseDown={beginSelect}
              onMouseMove={extendSelect}
              onMouseUp={endSelect}
              style={{ cursor: "crosshair", userSelect: "none" }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--borderColor-muted, #d8dee4)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--fgColor-muted, #59636e)" }}
                minTickGap={24}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--fgColor-muted, #59636e)" }}
                width={64}
                tickFormatter={(v: number) => compactAic(v)}
              />
              <Tooltip content={<CapTooltip entitlement={entitlement} selection={selection} />} />
              {selStart && selEnd && (
                <ReferenceArea
                  x1={selStart}
                  x2={selEnd}
                  fill={SELECTION_COLOR}
                  fillOpacity={0.1}
                  stroke={SELECTION_COLOR}
                  strokeOpacity={0.4}
                  label={
                    selection
                      ? {
                          value: formatRangeLabel(selection),
                          position: "insideTop",
                          fontSize: 11,
                          fontWeight: 600,
                          fill: SELECTION_COLOR,
                        }
                      : undefined
                  }
                />
              )}
              <Area
                dataKey="band"
                stroke="none"
                fill={FORECAST_COLOR}
                fillOpacity={0.15}
                {...chartAnim}
                name="band"
              />
              {isScenario && (
                <Line
                  type="monotone"
                  dataKey="baselineLine"
                  stroke={BASELINE_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  {...chartAnim}
                  name="baseline"
                />
              )}
              <Line
                type="monotone"
                dataKey="forecastLine"
                stroke={FORECAST_COLOR}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                {...chartAnim}
                name="forecast"
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#0969da"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
                {...chartAnim}
                name="actual"
              />
              {lastActualDate && (
                <ReferenceLine
                  x={lastActualDate}
                  stroke="var(--fgColor-muted, #59636e)"
                  strokeDasharray="2 2"
                  label={{ value: "today", fontSize: 10, position: "insideTopRight" }}
                />
              )}
              {entitlement > 0 && (
                <ReferenceLine
                  y={entitlement}
                  stroke="#cf222e"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  label={{
                    value: `Entitlement ${formatAic(entitlement)}`,
                    fontSize: 10,
                    fill: "#cf222e",
                    position: "insideTopLeft",
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <Text className={styles.muted} style={{ fontSize: 12, marginTop: 8 }}>
          {selection
            ? "Tip: click the chart to clear the selection."
            : "Tip: drag across the chart to measure the AI Credits used between two dates."}
        </Text>

        <div className={styles.chartLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ backgroundColor: "#0969da" }} />
            Observed
          </span>
          {isScenario && (
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: BASELINE_COLOR }} />
              Baseline forecast
            </span>
          )}
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ backgroundColor: FORECAST_COLOR }} />
            {projectionLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | number[] | null;
}

function CapTooltip({
  active,
  payload,
  label,
  entitlement,
  selection,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  entitlement: number;
  selection?: RangeSelection | null;
}) {
  if (!active || !payload?.length) return null;

  const find = (key: string) => payload.find((p) => p.dataKey === key)?.value;
  const actual = find("actual") as number | null | undefined;
  const forecast = find("forecastLine") as number | undefined;
  const baseline = find("baselineLine") as number | undefined;
  const band = find("band") as [number, number] | undefined;

  const isProjected = actual == null;
  const value = (actual ?? forecast ?? 0) as number;
  const showBaseline =
    isProjected && baseline != null && Math.abs((forecast ?? 0) - baseline) > 0.5;
  const overageAic = entitlement > 0 ? Math.max(0, value - entitlement) : 0;

  // Running diff from the start of the selected range to the hovered point.
  // Only shown while hovering a point other than the range's own start.
  const hoveredDate = label != null ? String(label) : null;
  const inSelection = selection != null && hoveredDate != null && hoveredDate !== selection.startDate;
  const selDiff = inSelection ? value - selection.startValue : null;
  const selDays = inSelection ? Math.abs(daysBetween(selection.startDate, hoveredDate)) : null;

  return (
    <div
      style={{
        background: "var(--bgColor-default, #fff)",
        border: "1px solid var(--borderColor-default, #d1d9e0)",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        boxShadow: "var(--shadow-resting-medium, 0 3px 6px rgba(0,0,0,0.12))",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div>
        {isProjected ? "Forecast" : "Observed"}: {formatAic(value)} ({formatUsd(value * USD_PER_AIC)})
      </div>
      {showBaseline && baseline != null && (
        <div className={styles.muted}>Baseline: {formatAic(baseline)}</div>
      )}
      {isProjected && band && (
        <div className={styles.muted}>
          Range: {formatAic(band[0])} – {formatAic(band[1])}
        </div>
      )}
      {selDiff != null && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid var(--borderColor-muted, #d8dee4)",
          }}
        >
          <div className={styles.muted}>
            Selected from {selection!.startDate.slice(5)}
            {selDays != null ? ` · ${plural(selDays, "day")}` : ""}
          </div>
          <div style={{ color: SELECTION_COLOR, fontWeight: 600 }}>
            {selDiff >= 0 ? "+" : "−"}
            {formatAic(Math.abs(selDiff))}
          </div>
          <div style={{ color: SELECTION_COLOR }}>
            {formatUsd(Math.abs(selDiff) * USD_PER_AIC)}
          </div>
        </div>
      )}
      {overageAic > 0 && (
        <div style={{ color: "var(--fgColor-danger, #cf222e)", fontWeight: 600, marginTop: 4 }}>
          Overage: {formatAic(overageAic)} ({formatUsd(overageAic * USD_PER_AIC)})
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  info,
  value,
  sub,
  extra,
}: {
  title: string;
  info?: string;
  value: string;
  sub?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>
        {info ? (
          <span className={styles.labelWithInfo}>
            {title}
            <InfoTip text={info} />
          </span>
        ) : (
          title
        )}
      </div>
      <div className={styles.statValue}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
      {extra && <div className={styles.statSub}>{extra}</div>}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <PrimerTooltip text={text} direction="n">
      <IconButton
        icon={InfoIcon}
        aria-label={text}
        variant="invisible"
        size="small"
        unsafeDisableTooltip
        className={styles.infoButton}
      />
    </PrimerTooltip>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMonthEnd(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Whole days from today (local midnight) until the given ISO date. Negative = in the past. */
function daysFromToday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** Whole days between two ISO dates (b - a). */
function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  if (!ya || !ma || !da || !yb || !mb || !db) return 0;
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** "1 day" / "3 days". */
function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Compact label drawn across a selected range on the chart. */
function formatRangeLabel(sel: RangeSelection): string {
  return `${formatAic(sel.delta)} · ${formatUsd(sel.delta * USD_PER_AIC)} · ${plural(sel.days, "day")}`;
}

function formatAic(value: number): string {
  const n = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0,
  }).format(value);
  return `${n} AIC`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactAic(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
