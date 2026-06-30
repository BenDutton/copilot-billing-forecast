"use client";

import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Heading,
  Text,
  Label,
  TextInput,
  IconButton,
  Tooltip as PrimerTooltip,
} from "@primer/react";
import { InfoIcon, SearchIcon } from "@primer/octicons-react";
import { useReport } from "@/components/report-provider";
import { ComparisonDelta } from "@/components/comparison-delta";
import { usePrefersReducedMotion } from "@/components/use-prefers-reduced-motion";
import { ExportMenu } from "@/components/export-menu";
import { SortableTh, type SortDir } from "@/components/sortable-th";
import { aggregateByCostCenter, aggregateDaily, type CostCenterSummary } from "@/lib/report";
import { forecastDaily } from "@/lib/forecast";
import styles from "../app.module.css";

/** 1 AI Credit (AIC) = $0.01 USD. */
const USD_PER_AIC = 0.01;
/** Number of cost centers charted individually before the rest roll up into "Other". */
const TOP_N = 6;
/** Primer-flavoured categorical palette for the stacked area chart. */
const PALETTE = [
  "#0969da",
  "#8250df",
  "#1a7f37",
  "#bf3989",
  "#9a6700",
  "#cf222e",
  "#57606a",
];

interface CenterRow extends CostCenterSummary {
  runRate: number;
  projectedMonth: number;
}

type SortKey = "name" | "totalQuantity" | "share" | "users" | "models" | "runRate" | "projectedMonth";

/**
 * Days from the last observed day through the end of that calendar month.
 * GitHub AI Credit entitlements reset monthly, so projections run to month-end.
 */
function daysToMonthEnd(lastDay: string): number {
  const [y, m, d] = lastDay.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastOfMonth - d);
}

/** ISO date of the last day of the month containing `lastDay`. */
function monthEndDate(lastDay: string): string {
  const [y, m] = lastDay.split("-").map(Number);
  if (!y || !m) return lastDay;
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastOfMonth).padStart(2, "0")}`;
}

export function CostCenterRollup() {
  const { report, comparisonReport } = useReport();
  const prefersReducedMotion = usePrefersReducedMotion();
  const chartRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalQuantity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // The report's latest observed day is "today"; projections run to month-end.
  const lastDay = useMemo(() => {
    if (!report) return "";
    const daily = aggregateDaily(report.rows, "quantity");
    return daily.length ? daily[daily.length - 1].date : "";
  }, [report]);
  const daysRemaining = daysToMonthEnd(lastDay);

  const centers = useMemo<CenterRow[]>(() => {
    if (!report) return [];
    return aggregateByCostCenter(report.rows).map((c) => {
      const forecast = forecastDaily(c.daily, daysRemaining || 1);
      const runRate = forecast
        ? forecast.dailyRunRate
        : c.activeDays > 0
          ? c.totalQuantity / c.activeDays
          : 0;
      // Project the cost center's total for the current month: usage so far plus
      // its run rate over the days remaining until month-end.
      const projectedMonth = c.totalQuantity + runRate * daysRemaining;
      return { ...c, runRate, projectedMonth };
    });
  }, [report, daysRemaining]);

  // Previous-period equivalents for the comparable stat cards, derived from the
  // optional comparison report. Null when no previous month has been added.
  const previous = useMemo(() => {
    if (!comparisonReport) return null;
    const pCenters = aggregateByCostCenter(comparisonReport.rows);
    // Per-cost-center previous totals, keyed by name, for the breakdown table.
    const byCenter = new Map<string, number>();
    for (const c of pCenters) byCenter.set(c.name, c.totalQuantity);
    return {
      count: pCenters.length,
      total: pCenters.reduce((a, c) => a + c.totalQuantity, 0),
      users: pCenters.reduce((a, c) => a + c.users, 0),
      byCenter,
    };
  }, [comparisonReport]);

  // Build the stacked-area series: top N cost centers as keys, the rest as "Other".
  const { chartData, seriesKeys } = useMemo(() => {
    if (centers.length === 0) return { chartData: [], seriesKeys: [] as string[] };
    const top = centers.slice(0, TOP_N);
    const rest = centers.slice(TOP_N);
    const keys = top.map((c) => c.name);
    if (rest.length > 0) keys.push("Other");

    const byDate = new Map<string, Record<string, number>>();
    const ensure = (date: string) => {
      let row = byDate.get(date);
      if (!row) {
        row = {};
        for (const k of keys) row[k] = 0;
        byDate.set(date, row);
      }
      return row;
    };
    for (const c of top) {
      for (const p of c.daily) ensure(p.date)[c.name] += p.value;
    }
    for (const c of rest) {
      for (const p of c.daily) ensure(p.date)["Other"] += p.value;
    }
    const chart = [...byDate.entries()]
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { chartData: chart, seriesKeys: keys };
  }, [centers]);

  if (!report) return null;

  // Only the synthetic "(no cost center)" bucket present → no real cost centers.
  const hasRealCenters = centers.some((c) => c.name !== "(no cost center)");
  if (centers.length === 0 || !hasRealCenters) {
    return (
      <div className={styles.card}>
        <Heading as="h2" style={{ fontSize: 20, marginBottom: 4 }}>
          No cost center data
        </Heading>
        <Text as="p" className={styles.muted}>
          This report has no <code>cost_center_name</code>{" "}
          values, so usage can&apos;t
          be rolled up by cost center. Upload a usage report that includes cost center
          attribution.
        </Text>
      </div>
    );
  }

  const total = centers.reduce((a, c) => a + c.totalQuantity, 0);
  const topCenter = centers[0];
  const maxCenter = topCenter?.totalQuantity ?? 0;
  const monthEndLabel = lastDay ? formatMonthEnd(monthEndDate(lastDay)) : "month end";

  const colorFor = (key: string) => {
    if (key === "Other") return PALETTE[PALETTE.length - 1];
    const idx = seriesKeys.indexOf(key);
    return PALETTE[idx % (PALETTE.length - 1)];
  };

  // Table rows: filtered + sorted independently of the chart's top-N order.
  const q = filter.trim().toLowerCase();
  const dir = sortDir === "asc" ? 1 : -1;
  const tableCenters = centers
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const cmp =
        sortKey === "name"
          ? a.name.localeCompare(b.name)
          : (a[sortKey] as number) - (b[sortKey] as number);
      return cmp * dir;
    });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const chartAnim = {
    isAnimationActive: !prefersReducedMotion,
    animationDuration: 600,
    animationEasing: "ease-out" as const,
  };

  return (
    <div className={styles.stack}>
      {/* Controls */}
      <div className={styles.controlsRow}>
        <Label variant="accent">{centers.length} cost centers · projection through {monthEndLabel}</Label>
      </div>

      {/* Summary stats */}
      <div className={styles.statGrid}>
        <StatCard
          title="Cost centers"
          info="Number of distinct cost centers the report attributes usage to (including an unattributed bucket if present)."
          value={centers.length.toLocaleString()}
          extra={
            previous ? (
              <ComparisonDelta
                current={centers.length}
                previous={previous.count}
                tone="neutral"
                format={(n) => n.toLocaleString()}
              />
            ) : undefined
          }
        />
        <StatCard
          title="Total"
          info="Total AI Credits consumed across all cost centers in the report."
          value={formatAic(total)}
          sub={formatUsd(total * USD_PER_AIC)}
          extra={
            previous ? (
              <ComparisonDelta current={total} previous={previous.total} format={formatAic} />
            ) : undefined
          }
        />
        <StatCard
          title="Top cost center"
          info="The cost center with the highest AI Credit consumption, and its share of the total."
          value={topCenter?.name ?? "-"}
          sub={`${formatAic(topCenter?.totalQuantity ?? 0)} · ${formatPct(topCenter?.share ?? 0)}`}
        />
        <StatCard
          title="Active users"
          info="Total distinct users observed across all cost centers."
          value={centers.reduce((a, c) => a + c.users, 0).toLocaleString()}
          extra={
            previous ? (
              <ComparisonDelta
                current={centers.reduce((a, c) => a + c.users, 0)}
                previous={previous.users}
                tone="neutral"
                format={(n) => n.toLocaleString()}
              />
            ) : undefined
          }
        />
      </div>

      {/* Stacked area chart */}
      <div className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              AI Credits by cost center over time
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Stacked daily usage for the top {TOP_N} cost centers
              {centers.length > TOP_N ? ", with the rest grouped as “Other”" : ""}.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <Label variant="accent">{report.reportType.toUpperCase()} report</Label>
            <ExportMenu
              chartRef={chartRef}
              title="Cost Center Rollup"
              subtitle="AI Credits by cost center over time"
              stats={[
                { label: "Cost centers", value: centers.length.toLocaleString() },
                { label: "Total", value: formatAic(total), sub: formatUsd(total * USD_PER_AIC) },
                {
                  label: "Top cost center",
                  value: topCenter?.name ?? "-",
                  sub: `${formatAic(topCenter?.totalQuantity ?? 0)} · ${formatPct(topCenter?.share ?? 0)}`,
                },
                {
                  label: "Active users",
                  value: centers.reduce((a, c) => a + c.users, 0).toLocaleString(),
                },
              ]}
            />
          </div>
        </div>

        <div className={styles.chartLegend}>
          {seriesKeys.map((k) => (
            <span key={k} className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: colorFor(k) }} />
              {k}
            </span>
          ))}
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
              <Tooltip content={<CenterTooltip colorFor={colorFor} />} />
              {seriesKeys.map((k) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="centers"
                  stroke={colorFor(k)}
                  fill={colorFor(k)}
                  fillOpacity={0.55}
                  {...chartAnim}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cost center table */}
      <div className={styles.card}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              Cost center breakdown
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Share of total spend, users, models, run rate, and projected month.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <TextInput
              className={styles.tableSearch}
              leadingVisual={SearchIcon}
              placeholder="Filter cost centers"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter cost centers"
              size="small"
            />
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.userTable} ${styles.zebra}`}>
            <thead>
              <tr>
                <SortableTh
                  label="Cost center"
                  sortKey="name"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Total"
                  sortKey="totalQuantity"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  numeric
                />
                <SortableTh
                  label="Share"
                  sortKey="share"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <SortableTh
                  label="Users"
                  sortKey="users"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  numeric
                />
                <SortableTh
                  label="Models"
                  sortKey="models"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  numeric
                />
                <SortableTh
                  label="Run rate"
                  sortKey="runRate"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  numeric
                />
                <SortableTh
                  label="Projected month"
                  sortKey="projectedMonth"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  numeric
                />
                {previous && <th className={styles.numCol}>vs last month</th>}
              </tr>
            </thead>
            <tbody>
              {tableCenters.map((c) => {
                const width = maxCenter > 0 ? (c.totalQuantity / maxCenter) * 100 : 0;
                return (
                  <tr key={c.name}>
                    <td>
                      <span className={styles.modelDot} style={{ backgroundColor: colorFor(c.name) }} />
                      <span className={styles.userName}>{c.name}</span>
                    </td>
                    <td className={styles.numCol}>
                      {formatAic(c.totalQuantity)}
                      <span className={styles.costInline}>{formatUsd(c.totalQuantity * USD_PER_AIC)}</span>
                    </td>
                    <td>
                      <div className={styles.utilCell}>
                        <div className={styles.utilTrack}>
                          <div
                            className={styles.utilFill}
                            style={{ width: `${width}%`, backgroundColor: colorFor(c.name) }}
                          />
                        </div>
                        <span className={styles.utilPct}>{formatPct(c.share)}</span>
                      </div>
                    </td>
                    <td className={styles.numCol}>{c.users || "-"}</td>
                    <td className={styles.numCol}>{c.models || "-"}</td>
                    <td className={styles.numCol}>{`${formatAic(c.runRate)}/day`}</td>
                    <td className={styles.numCol}>
                      {formatAic(c.projectedMonth)}
                      <span className={styles.costInline}>{formatUsd(c.projectedMonth * USD_PER_AIC)}</span>
                    </td>
                    {previous && (
                      <td className={styles.numCol}>
                        <ComparisonDelta
                          compact
                          current={c.totalQuantity}
                          previous={previous.byCenter.get(c.name) ?? 0}
                          format={formatAic}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {tableCenters.length === 0 && (
                <tr>
                  <td colSpan={previous ? 8 : 7} className={styles.tableEmpty}>
                    No cost centers match “{filter}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | null;
  name?: string;
}

function CenterTooltip({
  active,
  payload,
  label,
  colorFor,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  colorFor: (key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter((p) => (p.value ?? 0) > 0);
  const total = entries.reduce((a, p) => a + (p.value ?? 0), 0);
  return (
    <div
      style={{
        background: "var(--bgColor-default, #fff)",
        border: "1px solid var(--borderColor-default, #d1d9e0)",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        boxShadow: "var(--shadow-resting-medium, 0 3px 6px rgba(0,0,0,0.12))",
        maxWidth: 260,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {entries.map((p) => {
        const key = String(p.dataKey ?? "");
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={styles.legendSwatch} style={{ backgroundColor: colorFor(key) }} />
            <span>{key}:</span>
            <span style={{ marginLeft: "auto", fontWeight: 600 }}>{formatAic(p.value ?? 0)}</span>
          </div>
        );
      })}
      <div className={styles.muted} style={{ marginTop: 4 }}>
        Total: {formatAic(total)}
      </div>
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

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
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

function compactAic(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
