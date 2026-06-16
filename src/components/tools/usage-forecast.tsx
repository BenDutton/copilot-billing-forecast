"use client";

import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Heading, Text, Label, FormControl, TextInput, Tooltip as PrimerTooltip, IconButton } from "@primer/react";
import {
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  DashIcon,
  InfoIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { useReport } from "@/components/report-provider";
import { ExportMenu } from "@/components/export-menu";
import { usePersistentState } from "@/components/use-persistent-state";
import { aggregateDaily, sumMetric } from "@/lib/report";
import { forecastDaily } from "@/lib/forecast";
import styles from "../app.module.css";

/** 1 AI Credit (AIC) = $0.01 USD. */
const USD_PER_AIC = 0.01;

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

export function UsageForecast() {
  const { report } = useReport();
  const [entitlementInput, setEntitlementInput] = usePersistentState(
    "usage-forecast:entitlement",
  );
  const [adjustPct, setAdjustPct] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);

  const entitlement = Math.max(0, Number(entitlementInput) || 0);
  // What-if multiplier applied to the projected (future) daily run rate.
  const multiplier = 1 + adjustPct / 100;

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
        return {
          date: p.date,
          actual: round2(runA),
          forecast: round2(runA),
          baseline: round2(runA),
          band: [round2(runA), round2(runA)] as [number, number],
        };
      }
      if (i === obs) {
        runF = seed;
        runL = seed;
        runU = seed;
        runBase = seed;
      }
      runF += p.forecast * multiplier;
      runL += p.lower * multiplier;
      runU += p.upper * multiplier;
      runBase += p.forecast;
      return {
        date: p.date,
        actual: null,
        forecast: round2(runF),
        baseline: round2(runBase),
        band: [round2(runL), round2(runU)] as [number, number],
      };
    });
  }, [forecast, multiplier]);

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

  // End-of-horizon projected cumulative total (AIC) and its band, adjusted by the
  // what-if multiplier. `baselineEnd` is the unadjusted projection for comparison.
  const projectedEnd = forecast.observedTotal + forecast.projectedTotal * multiplier;
  const projectedEndLower = forecast.observedTotal + forecast.projectedLower * multiplier;
  const projectedEndUpper = forecast.observedTotal + forecast.projectedUpper * multiplier;
  const baselineEnd = forecast.observedTotal + forecast.projectedTotal;
  const scenarioDelta = projectedEnd - baselineEnd;
  const adjustedRate = forecast.dailyRunRate * multiplier;

  const overageAic = entitlement > 0 ? Math.max(0, projectedEnd - entitlement) : 0;
  const overageUsd = overageAic * USD_PER_AIC;

  const exportStats = [
    { label: "Observed total", value: formatAic(observed), sub: `${forecast.observedDays} days` },
    {
      label: adjustPct !== 0 ? "Scenario run rate" : "Daily run rate",
      value: `${formatAic(adjustPct !== 0 ? adjustedRate : forecast.dailyRunRate)}/day`,
    },
    {
      label: adjustPct !== 0 ? "Scenario month total" : "Projected month total",
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

  return (
    <div className={styles.stack}>
      {/* Controls */}
      <div className={styles.controlsRow}>
        <Label variant="accent">Projection through {monthEndLabel}</Label>
        <div className={styles.controlsGroup}>
          <div className={styles.sliderField}>
            <span className={styles.labelWithInfo} style={{ fontSize: 12, fontWeight: 600 }}>
              Run-rate change
              <InfoTip text="What-if: adjust the projected daily usage from today onward. Drag left to model cutting usage, right to model growth. Observed days are unchanged." />
            </span>
            <div className={styles.sliderRow}>
              <input
                type="range"
                min={-100}
                max={100}
                step={5}
                value={adjustPct}
                onChange={(e) => setAdjustPct(Number(e.target.value))}
                aria-label="Run-rate change percentage"
                style={{ width: 200 }}
              />
              <span className={styles.sliderValue}>
                <Label variant={adjustPct === 0 ? "secondary" : adjustPct < 0 ? "success" : "danger"}>
                  {adjustPct > 0 ? "+" : ""}
                  {adjustPct}%
                </Label>
              </span>
              <PrimerTooltip text="Reset run-rate change to 0%" direction="n">
                <IconButton
                  icon={XCircleFillIcon}
                  aria-label="Reset run-rate change to 0%"
                  variant="invisible"
                  size="small"
                  unsafeDisableTooltip
                  onClick={() => setAdjustPct(0)}
                  style={{ visibility: adjustPct === 0 ? "hidden" : "visible" }}
                />
              </PrimerTooltip>
            </div>
          </div>
          <FormControl>
            <FormControl.Label>
              <span className={styles.labelWithInfo}>
                AI Credit entitlement
                <InfoTip text="Your monthly AI Credit allowance. Shown as a dotted cap line on the chart. 1 AIC = $0.01 USD, so any projected overage is also priced in USD." />
              </span>
            </FormControl.Label>
            <TextInput
              type="number"
              min={0}
              placeholder="e.g. 3900"
              value={entitlementInput}
              onChange={(e) => setEntitlementInput(e.target.value)}
              trailingVisual="AIC"
              style={{ width: 200 }}
            />
          </FormControl>
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
          info="Average AI Credits consumed per day, derived from the trend line fitted to your usage. The most recent day is often incomplete, so it is left out of the trend fit (it still counts toward the observed total). With a run-rate change applied, this shows the adjusted scenario rate."
          value={`${formatAic(adjustPct !== 0 ? adjustedRate : forecast.dailyRunRate)}/day`}
          sub={
            adjustPct !== 0
              ? `Baseline ${formatAic(forecast.dailyRunRate)}/day`
              : `${formatUsd(forecast.dailyRunRate * USD_PER_AIC)}/day`
          }
        />
        <StatCard
          title={adjustPct !== 0 ? "Scenario month total" : "Projected month total"}
          info="Estimated cumulative AI Credits by the end of the current month if usage continues at the current rate. The range is an approximate 95% confidence band."
          value={formatAic(projectedEnd)}
          sub={`${formatAic(projectedEndLower)} – ${formatAic(projectedEndUpper)}`}
          extra={
            <>
              <span
                style={{
                  display: "block",
                  visibility: adjustPct !== 0 ? "visible" : "hidden",
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
              <InfoTip text="The projection fits a linear regression to your daily usage and extends it to month-end. The shaded band is an approximate 95% prediction interval: it widens with day-to-day variability and the further it projects, and is floored at zero. The most recent (partial) day is excluded from the fit so it doesn't drag the trend down." />
            </span>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Solid line is observed usage; the dashed purple line is the projected trend
              with an approximate 95% confidence band
              {adjustPct !== 0 ? ", adjusted by your run-rate change versus the grey baseline" : ""}
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
            <ComposedChart data={cumulativeData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
              <Tooltip content={<CapTooltip entitlement={entitlement} />} />
              <Area
                dataKey="band"
                stroke="none"
                fill="#8250df"
                fillOpacity={0.15}
                isAnimationActive={false}
                name="band"
              />
              {adjustPct !== 0 && (
                <Line
                  type="monotone"
                  dataKey="baseline"
                  stroke="#57606a"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                  name="baseline"
                />
              )}
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="#8250df"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
                name="forecast"
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#0969da"
                strokeWidth={2.5}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
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

        <div className={styles.chartLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ backgroundColor: "#0969da" }} />
            Observed
          </span>
          {adjustPct !== 0 && (
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: "#57606a" }} />
              Baseline forecast
            </span>
          )}
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ backgroundColor: "#8250df" }} />
            {adjustPct !== 0 ? "Scenario" : "Forecast"}
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
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  entitlement: number;
}) {
  if (!active || !payload?.length) return null;

  const find = (key: string) => payload.find((p) => p.dataKey === key)?.value;
  const actual = find("actual") as number | null | undefined;
  const forecast = find("forecast") as number | undefined;
  const baseline = find("baseline") as number | undefined;
  const band = find("band") as [number, number] | undefined;

  const isProjected = actual == null;
  const value = (actual ?? forecast ?? 0) as number;
  const showBaseline =
    isProjected && baseline != null && Math.abs((forecast ?? 0) - baseline) > 0.5;
  const overageAic = entitlement > 0 ? Math.max(0, value - entitlement) : 0;

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
