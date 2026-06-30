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
import {
  InfoIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  DashIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@primer/octicons-react";
import { useReport } from "@/components/report-provider";
import { ComparisonDelta } from "@/components/comparison-delta";
import { usePrefersReducedMotion } from "@/components/use-prefers-reduced-motion";
import { ExportMenu } from "@/components/export-menu";
import { SortableTh, type SortDir } from "@/components/sortable-th";
import { aggregateByModel, type ModelSummary, type DailyPoint } from "@/lib/report";
import { forecastDaily } from "@/lib/forecast";
import styles from "../app.module.css";

const USD_PER_AIC = 0.01;
/** Number of models charted individually before the rest roll up into "Other". */
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

const TREND_META = {
  rising: { label: "Rising", variant: "success", Icon: ArrowUpRightIcon },
  falling: { label: "Falling", variant: "danger", Icon: ArrowDownRightIcon },
  flat: { label: "Flat", variant: "secondary", Icon: DashIcon },
} as const;

interface ModelRow extends ModelSummary {
  trend: "rising" | "falling" | "flat";
}

/**
 * A row in the breakdown table. Most rows map 1:1 to a model, but all Auto
 * model selections are collapsed into a single aggregate row whose `children`
 * hold the individual auto-selected models.
 */
interface DisplayRow {
  /** Unique key for React + expansion tracking. */
  key: string;
  /** Display label. */
  model: string;
  totalQuantity: number;
  share: number;
  users: number;
  trend: "rising" | "falling" | "flat";
  /** Present only on the aggregated Auto group row. */
  children?: ModelRow[];
}

type SortKey = "model" | "totalQuantity" | "share" | "users";

export function ModelBreakdown() {
  const { report, comparisonReport } = useReport();
  const prefersReducedMotion = usePrefersReducedMotion();
  const chartRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalQuantity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const models = useMemo<ModelRow[]>(() => {
    if (!report) return [];
    return aggregateByModel(report.rows).map((m) => {
      const forecast = forecastDaily(m.daily, 30);
      return { ...m, trend: forecast?.trend ?? "flat" };
    });
  }, [report]);

  // Previous-period equivalents for the comparable stat cards, derived from the
  // optional comparison report. Null when no previous month has been added.
  const previous = useMemo(() => {
    if (!comparisonReport) return null;
    const pModels = aggregateByModel(comparisonReport.rows);
    // Per-model previous totals for the table. Auto selections are summed into a
    // single bucket so they line up with the collapsed "Auto" row.
    const byModel = new Map<string, number>();
    let autoTotal = 0;
    for (const m of pModels) {
      byModel.set(m.model, m.totalQuantity);
      if (isAutoModel(m.model)) autoTotal += m.totalQuantity;
    }
    return {
      count: pModels.length,
      total: pModels.reduce((a, m) => a + m.totalQuantity, 0),
      byModel,
      autoTotal,
    };
  }, [comparisonReport]);

  // Models with all Auto selections collapsed into a single "Auto" entry, re-ranked
  // by total. Shared by the chart, "Top model", and "Fastest growing" so they all
  // treat Auto as one model (matching the breakdown table).
  const bundledModels = useMemo<ModelRow[]>(() => {
    if (models.length === 0) return [];
    const autoModels = models.filter((m) => isAutoModel(m.model));
    const nonAuto = models.filter((m) => !isAutoModel(m.model));
    if (autoModels.length === 0) return [...models];

    const merged = new Map<string, number>();
    for (const m of autoModels) {
      for (const p of m.daily) merged.set(p.date, (merged.get(p.date) ?? 0) + p.value);
    }
    const daily: DailyPoint[] = [...merged.entries()]
      .map(([date, value]) => ({ date, t: Date.parse(`${date}T00:00:00Z`), value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);

    // Distinct users across all auto models (per-model counts would double-count
    // anyone who used more than one auto-selected model).
    const autoUsers = new Set<string>();
    if (report) {
      for (const r of report.rows) {
        if (r.username && isAutoModel(r.model ?? "")) autoUsers.add(r.username);
      }
    }

    const autoRow: ModelRow = {
      model: "Auto",
      totalQuantity: autoModels.reduce((a, m) => a + m.totalQuantity, 0),
      share: autoModels.reduce((a, m) => a + m.share, 0),
      users: autoUsers.size,
      daily,
      firstDay: daily.length ? daily[0].date : "",
      lastDay: daily.length ? daily[daily.length - 1].date : "",
      trend: forecastDaily(daily, 30)?.trend ?? "flat",
    };
    return [...nonAuto, autoRow].sort((a, b) => b.totalQuantity - a.totalQuantity);
  }, [models, report]);

  // Build the stacked-area series: top N models as their own keys, the rest as "Other".
  // Uses the Auto-bundled model list so the chart matches the table's grouping.
  const { chartData, seriesKeys } = useMemo(() => {
    if (bundledModels.length === 0) return { chartData: [], seriesKeys: [] as string[] };
    const top = bundledModels.slice(0, TOP_N);
    const rest = bundledModels.slice(TOP_N);
    const keys = top.map((m) => m.model);
    const hasOther = rest.length > 0;
    if (hasOther) keys.push("Other");

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
    for (const m of top) {
      for (const p of m.daily) ensure(p.date)[m.model] += p.value;
    }
    for (const m of rest) {
      for (const p of m.daily) ensure(p.date)["Other"] += p.value;
    }
    const chart = [...byDate.entries()]
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { chartData: chart, seriesKeys: keys };
  }, [bundledModels]);

  // Collapse all Auto model selections into one aggregate row with the
  // individual auto-selected models as expandable children.
  const groupedRows = useMemo<DisplayRow[]>(() => {
    if (!report) return [];
    const autoModels = models.filter((m) => isAutoModel(m.model));
    const rows: DisplayRow[] = models
      .filter((m) => !isAutoModel(m.model))
      .map((m) => ({
        key: m.model,
        model: m.model,
        totalQuantity: m.totalQuantity,
        share: m.share,
        users: m.users,
        trend: m.trend,
      }));

    if (autoModels.length > 0) {
      const totalQuantity = autoModels.reduce((a, m) => a + m.totalQuantity, 0);
      const share = autoModels.reduce((a, m) => a + m.share, 0);
      // Distinct users across all auto models (per-model counts would double-count
      // anyone who used more than one auto-selected model).
      const autoUsers = new Set<string>();
      for (const r of report.rows) {
        if (r.username && isAutoModel(r.model ?? "")) autoUsers.add(r.username);
      }
      // Combine the daily series so the group gets a single trend.
      const byDate = new Map<string, number>();
      for (const m of autoModels) {
        for (const p of m.daily) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.value);
      }
      const daily = [...byDate.entries()]
        .map(([date, value]) => ({ date, t: Date.parse(`${date}T00:00:00Z`), value }))
        .filter((p) => Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t);
      const trend = forecastDaily(daily, 30)?.trend ?? "flat";

      rows.push({
        key: "__auto__",
        model: "Auto",
        totalQuantity,
        share,
        users: autoUsers.size,
        trend,
        children: [...autoModels].sort((a, b) => b.totalQuantity - a.totalQuantity),
      });
    }
    return rows;
  }, [models, report]);

  // Table rows: filtered + sorted independently of the chart's top-N order.
  const tableModels = useMemo<DisplayRow[]>(() => {
    const q = filter.trim().toLowerCase();
    const arr = groupedRows.filter((m) => {
      if (!q) return true;
      if (m.model.toLowerCase().includes(q)) return true;
      return m.children?.some((c) => c.model.toLowerCase().includes(q)) ?? false;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const cmp =
        sortKey === "model"
          ? a.model.localeCompare(b.model)
          : (a[sortKey] as number) - (b[sortKey] as number);
      return cmp * dir;
    });
    return arr;
  }, [groupedRows, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "model" ? "asc" : "desc");
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!report) return null;

  if (models.length === 0) {
    return (
      <div className={styles.card}>
        <Heading as="h2" style={{ fontSize: 20, marginBottom: 4 }}>
          No model data
        </Heading>
        <Text as="p" className={styles.muted}>
          This report has no <code>model</code> column, so usage can&apos;t be broken
          down by model. Upload an AI usage report that includes a model column.
        </Text>
      </div>
    );
  }

  const total = models.reduce((a, m) => a + m.totalQuantity, 0);
  // Top model and fastest-growing treat Auto as one bundled model (matching the table).
  const topModel = bundledModels[0];
  // AI Credits attributed to an "Auto" model selection (case-insensitive). Copilot
  // reports these under a model literally named "auto".
  const autoAic = models
    .filter((m) => isAutoModel(m.model))
    .reduce((a, m) => a + m.totalQuantity, 0);
  const autoShare = total > 0 ? autoAic / total : 0;
  const rising = [...bundledModels]
    .map((m) => ({ m, slope: slopeOf(m) }))
    .filter((x) => x.slope > 0)
    .sort((a, b) => b.slope - a.slope)[0]?.m;
  const maxModel = topModel?.totalQuantity ?? 0;

  const colorFor = (key: string) => {
    if (key === "Other") return PALETTE[PALETTE.length - 1];
    const idx = seriesKeys.indexOf(key);
    return PALETTE[idx % (PALETTE.length - 1)];
  };

  const chartAnim = {
    isAnimationActive: !prefersReducedMotion,
    animationDuration: 600,
    animationEasing: "ease-out" as const,
  };

  return (
    <div className={styles.stack}>
      {/* Summary stats */}
      <div className={styles.statGrid}>
        <StatCard
          title="Models"
          info="Number of distinct models the report attributes AI Credit usage to."
          value={models.length.toLocaleString()}
          extra={
            previous ? (
              <ComparisonDelta
                current={models.length}
                previous={previous.count}
                tone="neutral"
                format={(n) => n.toLocaleString()}
              />
            ) : undefined
          }
        />
        <StatCard
          title="Total"
          info="Total AI Credits consumed across all models in the report."
          value={formatAic(total)}
          sub={formatUsd(total * USD_PER_AIC)}
          extra={
            previous ? (
              <ComparisonDelta current={total} previous={previous.total} format={formatAic} />
            ) : undefined
          }
        />
        <StatCard
          title="Top model"
          info="The model with the highest AI Credit consumption, and its share of the total."
          value={topModel?.model ?? "-"}
          sub={`${formatAic(topModel?.totalQuantity ?? 0)} · ${formatPct(topModel?.share ?? 0)}`}
        />
        <StatCard
          title="Auto model usage"
          info="Share of AI Credits attributed to an “Auto” model selection (where Copilot picks the model automatically). Higher adoption is generally more cost-efficient."
          value={formatPct(autoShare)}
          valueColor={autoShareColor(autoShare)}
          sub={`${formatAic(autoAic)} of ${formatAic(total)}`}
        />
        <StatCard
          title="Fastest growing"
          info="The model with the steepest rising daily trend over the report period."
          value={rising?.model ?? "No upward trend"}
          sub={rising ? `${formatAic(rising.totalQuantity)} total` : undefined}
        />
      </div>

      {/* Stacked area chart */}
      <div className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              AI Credits by model over time
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Stacked daily usage for the top {TOP_N} models, with Auto selections
              combined
              {models.length > TOP_N ? " and the rest grouped as “Other”" : ""}.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <Label variant="accent">{report.reportType.toUpperCase()} report</Label>
            <ExportMenu
              chartRef={chartRef}
              title="Model Breakdown"
              subtitle="AI Credits by model over time"
              stats={[
                { label: "Models", value: models.length.toLocaleString() },
                { label: "Total", value: formatAic(total), sub: formatUsd(total * USD_PER_AIC) },
                {
                  label: "Top model",
                  value: topModel?.model ?? "-",
                  sub: `${formatAic(topModel?.totalQuantity ?? 0)} · ${formatPct(topModel?.share ?? 0)}`,
                },
                {
                  label: "Auto model usage",
                  value: formatPct(autoShare),
                  sub: `${formatAic(autoAic)} of ${formatAic(total)}`,
                },
                {
                  label: "Fastest growing",
                  value: rising?.model ?? "No upward trend",
                  sub: rising ? `${formatAic(rising.totalQuantity)} total` : undefined,
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
              <Tooltip content={<ModelTooltip colorFor={colorFor} />} />
              {seriesKeys.map((k) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="models"
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

      {/* Model table */}
      <div className={styles.card}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              Model breakdown
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Share of total spend, distinct users, and trend for each model. Auto
              selections are grouped - expand the Auto row to see individual models.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <TextInput
              className={styles.tableSearch}
              leadingVisual={SearchIcon}
              placeholder="Filter models"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter models"
              size="small"
            />
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.userTable}>
            <thead>
              <tr>
                <th className={styles.expandCol} aria-label="Expand" />
                <SortableTh
                  label="Model"
                  sortKey="model"
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
                <th>Trend</th>
                {previous && <th className={styles.numCol}>vs last month</th>}
              </tr>
            </thead>
            <tbody>
              {tableModels.map((m, idx) => {
                const trend = TREND_META[m.trend];
                const width = maxModel > 0 ? (m.totalQuantity / maxModel) * 100 : 0;
                const isGroup = !!m.children;
                const isOpen = isGroup && expanded.has(m.key);
                const dotColor = isGroup ? "var(--fgColor-done, #8250df)" : colorFor(m.model);
                const stripe = idx % 2 === 1;
                return (
                  <FragmentRow key={m.key}>
                    <tr
                      className={`${stripe ? styles.rowStripe : ""} ${isGroup ? styles.clickableRow : ""} ${isOpen ? styles.rowOpen : ""}`}
                      onClick={isGroup ? () => toggleExpand(m.key) : undefined}
                    >
                      <td className={styles.expandCol}>
                        {isGroup && (
                          <span className={styles.expandIcon} aria-hidden>
                            {isOpen ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={styles.modelDot} style={{ backgroundColor: dotColor }} />
                        <span className={styles.userName}>{m.model}</span>
                        {isGroup && (
                          <span style={{ marginLeft: 8 }}>
                            <Label variant="secondary">{m.children!.length} models</Label>
                          </span>
                        )}
                      </td>
                      <td className={styles.numCol}>
                        {formatAic(m.totalQuantity)}
                        <span className={styles.costInline}>{formatUsd(m.totalQuantity * USD_PER_AIC)}</span>
                      </td>
                      <td>
                        <div className={styles.utilCell}>
                          <div className={styles.utilTrack}>
                            <div
                              className={styles.utilFill}
                              style={{ width: `${width}%`, backgroundColor: dotColor }}
                            />
                          </div>
                          <span className={styles.utilPct}>{formatPct(m.share)}</span>
                        </div>
                      </td>
                      <td className={styles.numCol}>{m.users || "-"}</td>
                      <td>
                        <Label variant={trend.variant}>
                          <trend.Icon size={14} />
                          <span style={{ marginLeft: 4 }}>{trend.label}</span>
                        </Label>
                      </td>
                      {previous && (
                        <td className={styles.numCol}>
                          <ComparisonDelta
                            compact
                            current={m.totalQuantity}
                            previous={isGroup ? previous.autoTotal : previous.byModel.get(m.model) ?? 0}
                            format={formatAic}
                          />
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className={styles.detailRow}>
                        <td colSpan={99}>
                          <AutoModelDetail models={m.children!} groupTotal={m.totalQuantity} />
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
              {tableModels.length === 0 && (
                <tr>
                  <td colSpan={99} className={styles.tableEmpty}>
                    No models match “{filter}”.
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

/** Tiny wrapper so a main row + its detail row share one React key. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Expanded detail for the Auto group: the individual auto-selected models. */
function AutoModelDetail({
  models,
  groupTotal,
}: {
  models: ModelRow[];
  groupTotal: number;
}) {
  const maxModel = models[0]?.totalQuantity ?? 0;
  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeading}>
        <span>Auto-selected models ({models.length})</span>
      </div>
      <div className={styles.modelBars}>
        {models.map((m) => {
          const share = groupTotal > 0 ? (m.totalQuantity / groupTotal) * 100 : 0;
          const width = maxModel > 0 ? (m.totalQuantity / maxModel) * 100 : 0;
          return (
            <div key={m.model} className={styles.modelBarRow}>
              <span className={styles.modelBarName} title={m.model}>
                {m.model}
              </span>
              <span className={styles.modelBarTrack}>
                <span className={styles.modelBarFill} style={{ width: `${width}%` }} />
              </span>
              <span className={styles.modelBarVal}>
                {formatAic(m.totalQuantity)}
                <span className={styles.costInline}>{formatUsd(m.totalQuantity * USD_PER_AIC)}</span>
                {" · "}
                {share.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Approximate slope direction using first vs second half of the daily series. */
function slopeOf(m: ModelSummary): number {
  if (m.daily.length < 2) return 0;
  const mid = Math.floor(m.daily.length / 2);
  const first = m.daily.slice(0, mid).reduce((a, p) => a + p.value, 0) / Math.max(1, mid);
  const second =
    m.daily.slice(mid).reduce((a, p) => a + p.value, 0) / Math.max(1, m.daily.length - mid);
  return second - first;
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number;
}

function ModelTooltip({
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
  const entries = payload
    .filter((p) => typeof p.value === "number" && (p.value as number) > 0)
    .sort((a, b) => (b.value as number) - (a.value as number));
  const total = entries.reduce((a, p) => a + (p.value as number), 0);
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
      {entries.map((p) => (
        <div key={String(p.dataKey)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className={styles.legendSwatch}
            style={{ backgroundColor: colorFor(String(p.dataKey)) }}
          />
          <span style={{ flex: 1 }}>{String(p.dataKey)}</span>
          <span style={{ fontWeight: 600 }}>{formatAic(p.value as number)}</span>
        </div>
      ))}
      <div className={styles.muted} style={{ marginTop: 4 }}>
        Total {formatAic(total)} ({formatUsd(total * USD_PER_AIC)})
      </div>
    </div>
  );
}

function StatCard({
  title,
  info,
  value,
  sub,
  valueColor,
  extra,
}: {
  title: string;
  info?: string;
  value: string;
  sub?: string;
  valueColor?: string;
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
      <div className={styles.statValue} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
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
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
}

/**
 * Whether a model name denotes Copilot's automatic ("Auto") model selection.
 * Auto-selected models are reported with an "Auto:" prefix, e.g.
 * "Auto: GPT-5.3-Codex".
 */
function isAutoModel(model: string): boolean {
  return /^auto\s*:/i.test(model.trim());
}

/**
 * Traffic-light color for Auto adoption: green for high adoption (≥50%),
 * amber for moderate (≥20%), red for low.
 */
function autoShareColor(share: number): string {
  if (share >= 0.5) return "var(--fgColor-success, #1a7f37)";
  if (share >= 0.2) return "var(--fgColor-attention, #9a6700)";
  return "var(--fgColor-danger, #cf222e)";
}

function compactAic(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
