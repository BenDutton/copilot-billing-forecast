"use client";

import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Heading,
  Text,
  Label,
  SegmentedControl,
  IconButton,
  Button,
  Tooltip as PrimerTooltip,
} from "@primer/react";
import {
  InfoIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  AlertIcon,
} from "@primer/octicons-react";
import { useReport } from "@/components/report-provider";
import { ComparisonDelta } from "@/components/comparison-delta";
import { usePrefersReducedMotion } from "@/components/use-prefers-reduced-motion";
import { ExportMenu } from "@/components/export-menu";
import { aggregateDaily, dayContributions, sumMetric, activeDays } from "@/lib/report";
import { detectSpikes } from "@/lib/forecast";
import styles from "../app.module.css";

const USD_PER_AIC = 0.01;

/** Lower z = more sensitive (flags smaller deviations). */
const SENSITIVITY: Record<string, { label: string; z: number }> = {
  high: { label: "High", z: 1.5 },
  medium: { label: "Medium", z: 2 },
  low: { label: "Low", z: 3 },
};
const SENS_ORDER = ["high", "medium", "low"] as const;

export function SpikeDetection() {
  const { report, comparisonReport } = useReport();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [sensitivity, setSensitivity] = useState<string>("medium");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const chartRef = useRef<HTMLDivElement>(null);

  const z = SENSITIVITY[sensitivity].z;

  const toggleExpand = (date: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const daily = useMemo(
    () => (report ? aggregateDaily(report.rows, "quantity") : []),
    [report],
  );

  const analysis = useMemo(() => detectSpikes(daily, z), [daily, z]);

  const contributions = useMemo(
    () => (report ? dayContributions(report.rows) : new Map()),
    [report],
  );

  // Previous-period baseline run rate (avg AI Credits per active day), derived
  // from the optional comparison report. Null when no previous month is added.
  const previousBaseline = useMemo(() => {
    if (!comparisonReport) return null;
    const total = sumMetric(comparisonReport.rows, "quantity");
    const days = activeDays(comparisonReport.rows);
    return days > 0 ? total / days : 0;
  }, [comparisonReport]);

  if (!report) return null;

  if (!analysis) {
    return (
      <div className={styles.card}>
        <Heading as="h2" style={{ fontSize: 20, marginBottom: 4 }}>
          Not enough data
        </Heading>
        <Text as="p" className={styles.muted}>
          At least four distinct days of usage are required to establish a baseline
          and detect spikes. Try a report with a wider date range.
        </Text>
      </div>
    );
  }

  const chartData = analysis.points.map((p) => ({
    date: p.date,
    value: p.value,
    expected: p.expected,
    upper: p.upper,
    spike: p.isSpike ? p.value : null,
  }));

  const spikeCount = analysis.spikes.length;
  const biggest = analysis.spikes[0];
  const sortedContributors = (date: string, kind: "byUser" | "byModel") => {
    const entry = contributions.get(date);
    if (!entry) return [] as { name: string; qty: number }[];
    return [...(entry[kind] as Map<string, number>)]
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);
  };
  const topContributor = (date: string, kind: "byUser" | "byModel") =>
    sortedContributors(date, kind)[0] ?? null;

  const chartAnim = {
    isAnimationActive: !prefersReducedMotion,
    animationDuration: 600,
    animationEasing: "ease-out" as const,
  };

  return (
    <div className={styles.stack}>
      {/* Controls */}
      <div className={styles.controlsRow}>
        <Label variant="accent">
          {analysis.points.length} days · baseline {formatAic(analysis.baselineRunRate)}/day
        </Label>
        <div className={styles.sliderField}>
          <span className={styles.labelWithInfo} style={{ fontSize: 12, fontWeight: 600 }}>
            Sensitivity
            <InfoTip text="How far above the trend a day must sit to count as a spike. High flags smaller deviations (≥1.5σ); Low only flags extreme ones (≥3σ)." />
          </span>
          <div className={styles.fieldRow}>
            <SegmentedControl aria-label="Spike sensitivity" size="small">
              {SENS_ORDER.map((key) => (
                <SegmentedControl.Button
                  key={key}
                  selected={sensitivity === key}
                  onClick={() => setSensitivity(key)}
                >
                  {SENSITIVITY[key].label}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
            <Button
              variant="invisible"
              size="small"
              onClick={() => setSensitivity("medium")}
              disabled={sensitivity === "medium"}
            >
              Reset
            </Button>
          </div>
          <span className={styles.fieldHint}>
            Flagging days that sit ≥{z}σ above the trend.
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div className={styles.statGrid}>
        <StatCard
          title="Spike days"
          info="Number of days whose usage sits above the trend by more than the selected sensitivity threshold."
          value={spikeCount.toLocaleString()}
          extra={
            spikeCount > 0 ? (
              <span style={{ color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }}>
                Review recommended
              </span>
            ) : (
              <span style={{ color: "var(--fgColor-success, #1a7f37)", fontWeight: 600 }}>
                No anomalies
              </span>
            )
          }
        />
        <StatCard
          title="Baseline"
          info="Average AI Credits per day across the whole report - the expected daily level."
          value={`${formatAic(analysis.baselineRunRate)}/day`}
          sub={`${formatUsd(analysis.baselineRunRate * USD_PER_AIC)}/day`}
          extra={
            previousBaseline != null ? (
              <ComparisonDelta
                current={analysis.baselineRunRate}
                previous={previousBaseline}
                format={(n) => `${formatAic(n)}/day`}
              />
            ) : undefined
          }
        />
        <StatCard
          title="Biggest spike"
          info="The single day furthest above its expected trend value."
          value={biggest ? biggest.date : "-"}
          sub={
            biggest
              ? `${formatAic(biggest.value)} · ${formatMultiple(biggest.ratio)} expected`
              : undefined
          }
        />
        <StatCard
          title="Spike total"
          info="Combined excess AI Credits on spike days above their expected baseline."
          value={formatAic(analysis.spikes.reduce((a, s) => a + (s.value - s.expected), 0))}
          sub={formatUsd(
            analysis.spikes.reduce((a, s) => a + (s.value - s.expected), 0) * USD_PER_AIC,
          )}
        />
      </div>

      {/* Chart */}
      <div className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              Daily usage vs expected trend
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              The shaded band is the expected range; red dots mark days flagged as
              spikes at the selected sensitivity.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <Label variant="accent">{report.reportType.toUpperCase()} report</Label>
            <ExportMenu
              chartRef={chartRef}
              title="Spike Detection"
              subtitle="Daily usage vs expected trend"
              stats={[
                { label: "Spike days", value: spikeCount.toLocaleString() },
                {
                  label: "Baseline",
                  value: `${formatAic(analysis.baselineRunRate)}/day`,
                },
                {
                  label: "Biggest spike",
                  value: biggest ? biggest.date : "-",
                  sub: biggest ? `${formatMultiple(biggest.ratio)} expected` : undefined,
                },
                {
                  label: "Spike total",
                  value: formatAic(
                    analysis.spikes.reduce((a, s) => a + (s.value - s.expected), 0),
                  ),
                },
              ]}
            />
          </div>
        </div>

        <div className={styles.chartWrap} ref={chartRef}>
          <ResponsiveContainer initialDimension={{ width: 600, height: 300 }}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
              <Tooltip content={<SpikeTooltip />} />
              <Area
                dataKey="upper"
                stroke="none"
                fill="#0969da"
                fillOpacity={0.1}
                {...chartAnim}
                name="expected range"
              />
              <Line
                type="monotone"
                dataKey="expected"
                stroke="#57606a"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
                {...chartAnim}
                name="expected"
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#0969da"
                strokeWidth={2.5}
                dot={false}
                {...chartAnim}
                name="actual"
              />
              <Scatter dataKey="spike" fill="#cf222e" {...chartAnim} name="spike" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Spike table */}
      {spikeCount > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHeaderRow}>
            <div>
              <Heading as="h2" style={{ fontSize: 16 }}>
                Flagged spike days
              </Heading>
              <Text className={styles.muted} style={{ fontSize: 14 }}>
                Sorted by severity, with the top contributing user and model on each day.
              </Text>
            </div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.userTable}>
              <thead>
                <tr>
                  <th className={styles.expandCol} aria-label="Expand" />
                  <th>Date</th>
                  <th className={styles.numCol}>Actual</th>
                  <th className={styles.numCol}>Expected</th>
                  <th className={styles.numCol}>Above expected</th>
                  <th className={styles.numCol}>Severity</th>
                  <th>Top user</th>
                  <th>Top model</th>
                </tr>
              </thead>
              <tbody>
                {analysis.spikes.map((s) => {
                  const user = topContributor(s.date, "byUser");
                  const model = topContributor(s.date, "byModel");
                  const isOpen = expanded.has(s.date);
                  return (
                    <FragmentRow key={s.date}>
                      <tr
                        className={`${styles.clickableRow} ${isOpen ? styles.rowOpen : ""}`}
                        onClick={() => toggleExpand(s.date)}
                      >
                        <td className={styles.expandCol}>
                          <span className={styles.expandIcon} aria-hidden>
                            {isOpen ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                          </span>
                        </td>
                        <td>
                          <span className={styles.userName}>{s.date}</span>{" "}
                          <Text className={styles.muted} style={{ fontSize: 12 }}>
                            {dayOfWeek(s.date)}
                          </Text>
                        </td>
                        <td className={styles.numCol}>
                          {formatAic(s.value)}
                          <span className={styles.costInline}>{formatUsd(s.value * USD_PER_AIC)}</span>
                        </td>
                        <td className={styles.numCol}>{formatAic(s.expected)}</td>
                        <td className={styles.numCol}>
                          <span style={{ color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }}>
                            +{formatAic(s.value - s.expected)}
                          </span>
                          <span className={styles.costInline}>
                            +{formatUsd((s.value - s.expected) * USD_PER_AIC)}
                          </span>
                          <div className={styles.statSub}>{formatMultiple(s.ratio)} expected</div>
                        </td>
                        <td className={styles.numCol}>
                          <Label variant={s.z >= 3 ? "danger" : "attention"}>
                            {s.z >= 3 && <AlertIcon size={12} />}
                            <span style={{ marginLeft: s.z >= 3 ? 4 : 0 }}>{s.z.toFixed(1)}σ</span>
                          </Label>
                        </td>
                        <td>
                          {user ? (
                            <span title={`${user.name}: ${formatAic(user.qty)}`}>
                              {user.name}{" "}
                              <span className={styles.statSub}>({formatAic(user.qty)})</span>
                            </span>
                          ) : (
                            <Text className={styles.muted} style={{ fontSize: 12 }}>-</Text>
                          )}
                        </td>
                        <td>
                          {model ? (
                            <Label variant="secondary">{model.name}</Label>
                          ) : (
                            <Text className={styles.muted} style={{ fontSize: 12 }}>-</Text>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className={styles.detailRow}>
                          <td colSpan={8}>
                            <SpikeDetail
                              spike={s}
                              baseline={analysis.baselineRunRate}
                              users={sortedContributors(s.date, "byUser")}
                              models={sortedContributors(s.date, "byModel")}
                            />
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SpikeDetail({
  spike,
  baseline,
  users,
  models,
}: {
  spike: { date: string; value: number; expected: number; z: number; ratio: number };
  baseline: number;
  users: { name: string; qty: number }[];
  models: { name: string; qty: number }[];
}) {
  const above = spike.value - spike.expected;
  const vsBaseline = baseline > 0 ? (spike.value / baseline) * 100 : 0;
  const userTotal = users.reduce((a, u) => a + u.qty, 0);
  const topUserShare = userTotal > 0 && users[0] ? (users[0].qty / userTotal) * 100 : 0;
  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailGrid}>
        <div>
          <div className={styles.detailHeading}>
            <span>Severity</span>
          </div>
          <dl className={styles.detailList}>
            <dt>Actual</dt>
            <dd>
              {formatAic(spike.value)} ({formatUsd(spike.value * USD_PER_AIC)})
            </dd>
            <dt>Expected</dt>
            <dd>{formatAic(spike.expected)}</dd>
            <dt>Above expected</dt>
            <dd style={{ color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }}>
              +{formatAic(above)} ({formatMultiple(spike.ratio)})
            </dd>
            <dt>Standard deviations</dt>
            <dd>{spike.z.toFixed(1)}σ</dd>
            <dt>vs. baseline</dt>
            <dd>{vsBaseline.toFixed(0)}% of average day</dd>
            {users.length > 0 && (
              <>
                <dt>Concentration</dt>
                <dd>
                  Top user drove {topUserShare.toFixed(0)}% across {users.length}{" "}
                  {users.length === 1 ? "user" : "users"}
                </dd>
              </>
            )}
          </dl>
        </div>

        <div>
          <div className={styles.detailHeading}>
            <span>Top users ({users.length})</span>
          </div>
          <ContributorBars items={users} />
        </div>

        <div>
          <div className={styles.detailHeading}>
            <span>Top models ({models.length})</span>
          </div>
          <ContributorBars items={models} />
        </div>
      </div>
    </div>
  );
}

function ContributorBars({ items }: { items: { name: string; qty: number }[] }) {
  if (items.length === 0) {
    return (
      <Text className={styles.muted} style={{ fontSize: 12 }}>
        No attribution in this report.
      </Text>
    );
  }
  const total = items.reduce((a, i) => a + i.qty, 0);
  const max = items[0]?.qty ?? 0;
  return (
    <div className={styles.modelBars}>
      {items.slice(0, 6).map((i) => {
        const share = total > 0 ? (i.qty / total) * 100 : 0;
        const width = max > 0 ? (i.qty / max) * 100 : 0;
        return (
          <div key={i.name} className={styles.modelBarRow}>
            <span className={styles.modelBarName} title={i.name}>
              {i.name}
            </span>
            <span className={styles.modelBarTrack}>
              <span className={styles.modelBarFill} style={{ width: `${width}%` }} />
            </span>
            <span className={styles.modelBarVal}>
              {formatAic(i.qty)} · {share.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | null;
}

function SpikeTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const find = (key: string) => payload.find((p) => p.dataKey === key)?.value as number | undefined;
  const value = find("value");
  const expected = find("expected");
  const isSpike = (find("spike") ?? null) != null;
  const above = value != null && expected != null ? value - expected : undefined;
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
      {value != null && (
        <div>
          Actual: {formatAic(value)} ({formatUsd(value * USD_PER_AIC)})
        </div>
      )}
      {expected != null && <div className={styles.muted}>Expected: {formatAic(expected)}</div>}
      {isSpike && above != null && above > 0 && (
        <div style={{ color: "var(--fgColor-danger, #cf222e)", fontWeight: 600, marginTop: 4 }}>
          Spike: +{formatAic(above)} above expected
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

function formatMultiple(ratio: number): string {
  if (!Number.isFinite(ratio)) return "∞×";
  return `${ratio.toFixed(1)}×`;
}

/** Short weekday name for a YYYY-MM-DD date, parsed as local time. */
function dayOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { weekday: "short" });
}

function compactAic(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
