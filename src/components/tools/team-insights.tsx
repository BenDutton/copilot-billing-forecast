"use client";

import { useMemo, useState } from "react";
import {
  Heading,
  Text,
  Label,
  TextInput,
  IconButton,
  Tooltip as PrimerTooltip,
  Button,
} from "@primer/react";
import {
  InfoIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CalendarIcon,
  SearchIcon,
  AlertIcon,
} from "@primer/octicons-react";
import { useReport } from "@/components/report-provider";
import { ComparisonDelta } from "@/components/comparison-delta";
import { ExportMenu } from "@/components/export-menu";
import { usePersistentState } from "@/components/use-persistent-state";
import { SortableTh, type SortDir } from "@/components/sortable-th";
import { aggregateByUser, aggregateDaily, type UserUsage } from "@/lib/report";
import { forecastDaily } from "@/lib/forecast";
import styles from "../app.module.css";

/** 1 AI Credit (AIC) = $0.01 USD. */
const USD_PER_AIC = 0.01;
const PAGE_SIZE = 8;

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

interface UserRow extends UserUsage {
  runRate: number;
  projectedMonth: number;
}

/** Definition of a usage cohort, ranked by AI Credit consumption. */
interface UsageGroupDef {
  key: string;
  label: string;
  description: string;
}

/** Cohort buckets shown in the "Average usage by user group" table. */
const USAGE_GROUP_DEFS: UsageGroupDef[] = [
  { key: "power", label: "Power users", description: "Top 5% of active users by AIC gross cost." },
  { key: "heavy", label: "Heavy users", description: "Next 15% of active users by AIC gross cost." },
  { key: "typical", label: "Typical users", description: "Middle 55% of active users by AIC gross cost." },
  { key: "light", label: "Light users", description: "Lowest 25% of active users with at least $1 in AIC gross cost." },
  { key: "nearZero", label: "Near-zero users", description: "Users with less than $1 in AIC gross cost in this report." },
];

interface UsageGroup extends UsageGroupDef {
  /** Number of users in the cohort. */
  users: number;
  /** Total AI Credits consumed by the cohort. */
  totalQuantity: number;
  /** Mean AI Credits per user in the cohort. */
  avgQuantity: number;
  /** Median AI Credits per user in the cohort. */
  medianQuantity: number;
}

type SortKey =
  | "username"
  | "totalQuantity"
  | "activeDays"
  | "runRate"
  | "projectedMonth"
  | "utilization";

export function TeamInsights() {
  const { report, comparisonReport } = useReport();
  const [budgetInput, setBudgetInput] = usePersistentState(
    "team-insights:budget",
  );
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("totalQuantity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const budget = (() => {
    const n = Number(budgetInput);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  })();

  // The report's latest observed day is "today"; projections run to month-end.
  const lastDay = useMemo(() => {
    if (!report) return "";
    const daily = aggregateDaily(report.rows, "quantity");
    return daily.length ? daily[daily.length - 1].date : "";
  }, [report]);
  const daysRemaining = daysToMonthEnd(lastDay);

  const users = useMemo<UserRow[]>(() => {
    if (!report) return [];
    return aggregateByUser(report.rows).map((u) => {
      const forecast = forecastDaily(u.daily, daysRemaining || 1);
      // Average AI Credits per active day. Falls back to a simple mean when there
      // are too few days for a regression fit.
      const runRate = forecast
        ? forecast.dailyRunRate
        : u.activeDays > 0
          ? u.totalQuantity / u.activeDays
          : 0;
      // Project the user's total for the current month: what they've already used
      // plus their run rate over the days remaining until month-end.
      const projectedMonth = u.totalQuantity + runRate * daysRemaining;
      return { ...u, runRate, projectedMonth };
    });
  }, [report, daysRemaining]);

  const usageGroups = useMemo(() => classifyUsageGroups(users), [users]);

  // Previous-period equivalents for the comparable stat cards, derived from the
  // optional comparison report. Null when no previous month has been added.
  const previous = useMemo(() => {
    if (!comparisonReport) return null;
    const pUsers = aggregateByUser(comparisonReport.rows);
    const total = pUsers.reduce((a, u) => a + u.totalQuantity, 0);
    // Per-user previous totals, keyed by username, for the per-user table.
    const userTotals = new Map<string, number>();
    for (const u of pUsers) userTotals.set(u.username, u.totalQuantity);
    // Previous usage-group totals, keyed by group, for the user-group table.
    // `classifyUsageGroups` only reads `.totalQuantity`, so the run-rate and
    // projection fields can be zero-filled.
    const prevGroupTotals = new Map<string, number>();
    for (const g of classifyUsageGroups(
      pUsers.map((u) => ({ ...u, runRate: 0, projectedMonth: 0 })),
    )) {
      prevGroupTotals.set(g.key, g.totalQuantity);
    }
    return {
      users: pUsers.length,
      total,
      avg: pUsers.length ? total / pUsers.length : 0,
      userTotals,
      groupTotals: prevGroupTotals,
    };
  }, [comparisonReport]);

  const sortedUsers = useMemo<UserRow[]>(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...users];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "username") {
        cmp = a.username.localeCompare(b.username);
      } else if (sortKey === "utilization") {
        // Utilisation only meaningful with a budget; fall back to projected month.
        const av = budget > 0 ? a.projectedMonth / budget : a.projectedMonth;
        const bv = budget > 0 ? b.projectedMonth / budget : b.projectedMonth;
        cmp = av - bv;
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return cmp * dir;
    });
    return arr;
  }, [users, sortKey, sortDir, budget]);

  const filteredUsers = useMemo<UserRow[]>(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sortedUsers;
    return sortedUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.models.some((m) => m.model.toLowerCase().includes(q)),
    );
  }, [sortedUsers, filter]);

  if (!report) return null;

  const totalUsers = users.length;
  const totalAic = users.reduce((a, u) => a + u.totalQuantity, 0);
  const overBudget =
    budget > 0 ? users.filter((u) => u.projectedMonth > budget).length : 0;
  const monthEndLabel = lastDay ? formatMonthEnd(monthEndDate(lastDay)) : "month end";

  const matchCount = filteredUsers.length;
  const pageCount = Math.max(1, Math.ceil(matchCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageUsers = filteredUsers.slice(start, start + PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text sorts ascending by default; numeric columns descending (biggest first).
      setSortDir(key === "username" ? "asc" : "desc");
    }
    setPage(0);
  };

  const toggleExpand = (username: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  if (totalUsers === 0) {
    return (
      <div className={styles.card}>
        <Heading as="h2" style={{ fontSize: 20, marginBottom: 4 }}>
          No per-user data
        </Heading>
        <Text as="p" className={styles.muted}>
          This report has no <code>username</code> column, so usage can&apos;t be
          attributed to individual users. Upload a detailed or AI usage report that
          includes a user column.
        </Text>
      </div>
    );
  }

  // Oversized so the spanning cells (detail panel, empty state) always cover
  // every column regardless of how many are shown; browsers clamp colSpan to
  // the actual column count.
  const colSpan = 99;

  return (
    <div className={styles.stack}>
      {/* Controls */}
      <div className={styles.controlsRow}>
        <Label variant="accent">{totalUsers} users · projection through {monthEndLabel}</Label>
        <div className={styles.sliderField}>
          <span className={styles.labelWithInfo} style={{ fontSize: 12, fontWeight: 600 }}>
            Universal user budget
            <InfoTip text="Optional AI Credit budget applied to every user. Anyone whose projected month total exceeds it is flagged as over budget. 1 AIC = $0.01 USD." />
          </span>
          <div className={styles.fieldRow}>
            <TextInput
              type="number"
              min={0}
              placeholder="e.g. 5000"
              value={budgetInput}
              onChange={(e) => {
                setBudgetInput(e.target.value);
                setPage(0);
              }}
              trailingVisual="AIC"
              style={{ width: 240 }}
            />
            <Button
              variant="invisible"
              size="small"
              onClick={() => {
                setBudgetInput("");
                setPage(0);
              }}
              disabled={!budgetInput}
            >
              Reset
            </Button>
          </div>
          <span className={styles.fieldHint}>
            {budget > 0
              ? `Flagging users projected above ${formatAic(budget)} AIC.`
              : "Add a budget to flag users projected to exceed it."}
          </span>
        </div>
      </div>

      {/* Summary stats */}
      <div className={styles.statGrid}>
        <div className={`${styles.card} ${styles.usersCard}`}>
          <div className={styles.usersCardMain}>
            <div className={styles.cardLabel}>
              <span className={styles.labelWithInfo}>
                Users
                <InfoTip text="Number of distinct users the report attributes AI Credit usage to." />
              </span>
            </div>
            <div className={styles.statValue}>{totalUsers.toLocaleString()}</div>
            {previous && (
              <div className={styles.statSub}>
                <ComparisonDelta
                  current={totalUsers}
                  previous={previous.users}
                  tone="neutral"
                  format={(n) => n.toLocaleString()}
                />
              </div>
            )}
          </div>
          <SpendHistogram users={users} />
        </div>
        <StatCard
          title="Team total"
          info="Total AI Credits consumed across all users in the report."
          value={formatAic(totalAic)}
          sub={formatUsd(totalAic * USD_PER_AIC)}
          extra={
            previous ? (
              <ComparisonDelta current={totalAic} previous={previous.total} format={formatAic} />
            ) : undefined
          }
        />
        <StatCard
          title="Avg per user"
          info="Mean AI Credits per user across the report period."
          value={formatAic(totalUsers ? totalAic / totalUsers : 0)}
          sub={formatUsd((totalUsers ? totalAic / totalUsers : 0) * USD_PER_AIC)}
          extra={
            previous ? (
              <ComparisonDelta
                current={totalUsers ? totalAic / totalUsers : 0}
                previous={previous.avg}
                format={formatAic}
              />
            ) : undefined
          }
        />
        {budget > 0 ? (
          <StatCard
            title="Over budget"
            info="Users projected to exceed the per-user monthly budget at their current run rate."
            value={`${overBudget} / ${totalUsers}`}
            extra={
              overBudget > 0 ? (
                <span style={{ color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }}>
                  Action needed
                </span>
              ) : (
                <span style={{ color: "var(--fgColor-success, #1a7f37)", fontWeight: 600 }}>
                  All within budget
                </span>
              )
            }
          />
        ) : (
          <StatCard
            title="Top user"
            info="The single user with the highest observed AI Credit consumption."
            value={users[0]?.username ?? "-"}
            sub={formatAic(users[0]?.totalQuantity ?? 0)}
          />
        )}
      </div>

      {/* Usage by user group */}
      <div className={styles.card}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              Average usage by user group
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Active users ranked by AI Credit consumption and split into cohorts.
              Near-zero users have less than $1 of usage in this report.
            </Text>
          </div>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.userTable} ${styles.zebra}`}>
            <thead>
              <tr>
                <th>Group</th>
                <th>Definition</th>
                <th className={styles.numCol}>Users</th>
                <th className={styles.numCol}>Avg usage</th>
                <th className={styles.numCol}>Median usage</th>
                <th className={styles.numCol}>Group total</th>
                {previous && <th className={styles.numCol}>Last month</th>}
              </tr>
            </thead>
            <tbody>
              {usageGroups.map((g) => (
                <tr key={g.key}>
                  <td>
                    <span className={styles.userName}>{g.label}</span>
                  </td>
                  <td>
                    <Text className={styles.muted} style={{ fontSize: 12 }}>
                      {g.description}
                    </Text>
                  </td>
                  <td className={styles.numCol}>{g.users.toLocaleString()}</td>
                  <td className={styles.numCol}>
                    {g.users > 0 ? (
                      <>
                        {formatAic(g.avgQuantity)}
                        <span className={styles.costInline}>
                          {formatUsd(g.avgQuantity * USD_PER_AIC)}
                        </span>
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  <td className={styles.numCol}>
                    {g.users > 0 ? (
                      <>
                        {formatAic(g.medianQuantity)}
                        <span className={styles.costInline}>
                          {formatUsd(g.medianQuantity * USD_PER_AIC)}
                        </span>
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  <td className={styles.numCol}>
                    {g.users > 0 ? (
                      <>
                        {formatAic(g.totalQuantity)}
                        <span className={styles.costInline}>
                          {formatUsd(g.totalQuantity * USD_PER_AIC)}
                        </span>
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  {previous &&
                    (() => {
                      const prev = previous.groupTotals.get(g.key) ?? 0;
                      return (
                        <td className={styles.numCol}>
                          {formatAic(prev)}
                          <span className={styles.costInline}>
                            {formatUsd(prev * USD_PER_AIC)}
                          </span>
                          <div>
                            <ComparisonDelta
                              compact
                              current={g.totalQuantity}
                              previous={prev}
                              format={formatAic}
                            />
                          </div>
                        </td>
                      );
                    })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User table */}
      <div className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.cardHeaderRow}>
          <div>
            <Heading as="h2" style={{ fontSize: 16 }}>
              Per-user insights &amp; budget forecast
            </Heading>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              Click a row to expand. Sort any column by clicking its header. Projections
              estimate each user&apos;s total for the current month at their current run rate.
            </Text>
          </div>
          <div className={styles.cardHeaderActions}>
            <TextInput
              className={styles.tableSearch}
              leadingVisual={SearchIcon}
              placeholder="Filter users or models"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              aria-label="Filter users or models"
              size="small"
            />
            <Label variant="accent">{report.reportType.toUpperCase()} report</Label>
            <ExportMenu
              canExportPng={false}
              title="Team Insights"
              subtitle="Per-user insights & budget forecast"
              stats={[
                { label: "Users", value: totalUsers.toLocaleString() },
                {
                  label: "Team total",
                  value: formatAic(totalAic),
                  sub: formatUsd(totalAic * USD_PER_AIC),
                },
                {
                  label: "Avg per user",
                  value: formatAic(totalUsers ? totalAic / totalUsers : 0),
                },
                budget > 0
                  ? { label: "Over budget", value: `${overBudget} / ${totalUsers}` }
                  : {
                      label: "Top user",
                      value: users[0]?.username ?? "-",
                      sub: formatAic(users[0]?.totalQuantity ?? 0),
                    },
              ]}
            />
          </div>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.userTable}>
            <thead>
              <tr>
                <th className={styles.expandCol} aria-label="Expand" />
                <SortableTh
                  label="User"
                  sortKey="username"
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
                  label="Active days"
                  sortKey="activeDays"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  numeric
                />
                <th>Models</th>
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
                {budget > 0 && (
                  <SortableTh
                    label="Budget used"
                    sortKey="utilization"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                )}
                {previous && <th className={styles.numCol}>Last month</th>}
              </tr>
            </thead>
            <tbody>
              {pageUsers.map((u, idx) => {
                const over = budget > 0 && u.projectedMonth > budget;
                const isOpen = expanded.has(u.username);
                const util = budget > 0 ? (u.projectedMonth / budget) * 100 : 0;
                const stripe = idx % 2 === 1;
                return (
                  <FragmentRow key={u.username}>
                    <tr
                      className={`${styles.clickableRow} ${stripe ? styles.rowStripe : ""} ${isOpen ? styles.rowOpen : ""}`}
                      onClick={() => toggleExpand(u.username)}
                    >
                      <td className={styles.expandCol}>
                        <span className={styles.expandIcon} aria-hidden>
                          {isOpen ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                        </span>
                      </td>
                      <td>
                        <span className={styles.userName}>{u.username}</span>
                      </td>
                      <td className={styles.numCol}>
                        {formatAic(u.totalQuantity)}
                        <span className={styles.costInline}>
                          {formatUsd(u.totalQuantity * USD_PER_AIC)}
                        </span>
                      </td>
                      <td className={styles.numCol}>{u.activeDays}</td>
                      <td>
                        <ModelTags models={u.models} />
                      </td>
                      <td className={styles.numCol}>{`${formatAic(u.runRate)}/day`}</td>
                      <td className={styles.numCol}>
                        <div
                          style={
                            over
                              ? { color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }
                              : undefined
                          }
                        >
                          {over && (
                            <AlertIcon
                              size={12}
                              aria-label="Over budget"
                              className={styles.overBudgetIcon}
                            />
                          )}
                          {formatAic(u.projectedMonth)}
                          <span className={styles.costInline}>
                            {formatUsd(u.projectedMonth * USD_PER_AIC)}
                          </span>
                        </div>
                      </td>
                      {budget > 0 && (
                        <td>
                          <UtilizationBar pct={util} />
                        </td>
                      )}
                      {previous &&
                        (() => {
                          const prev = previous.userTotals.get(u.username) ?? 0;
                          return (
                            <td className={styles.numCol}>
                              {formatAic(prev)}
                              <span className={styles.costInline}>
                                {formatUsd(prev * USD_PER_AIC)}
                              </span>
                              <div>
                                <ComparisonDelta
                                  compact
                                  current={u.totalQuantity}
                                  previous={prev}
                                  format={formatAic}
                                />
                              </div>
                            </td>
                          );
                        })()}
                    </tr>
                    {isOpen && (
                      <tr className={styles.detailRow}>
                        <td colSpan={colSpan}>
                          <UserDetail user={u} budget={budget} />
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
              {pageUsers.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className={styles.tableEmpty}>
                    No users match “{filter}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className={styles.pagination}>
            <Button
              size="small"
              leadingVisual={ChevronLeftIcon}
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Text className={styles.muted} style={{ fontSize: 12 }}>
              Page {safePage + 1} of {pageCount} · {start + 1}–
              {Math.min(start + PAGE_SIZE, matchCount)} of {matchCount}
              {filter.trim() ? ` (filtered from ${totalUsers})` : ""}
            </Text>
            <Button
              size="small"
              trailingVisual={ChevronRightIcon}
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny wrapper so a main row + its detail row share one React key. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * Bucket users into usage cohorts by their share of AI Credit consumption.
 * Active users (at least $1 of gross cost) are ranked highest-first and split
 * by percentile; users below $1 fall into the near-zero cohort.
 */
function classifyUsageGroups(users: UserRow[]): UsageGroup[] {
  const active = users
    .filter((u) => u.totalQuantity * USD_PER_AIC >= 1)
    .sort((a, b) => b.totalQuantity - a.totalQuantity);
  const nearZero = users.filter((u) => u.totalQuantity * USD_PER_AIC < 1);
  const n = active.length;

  // Cumulative percentile cut points over the active users. Rounding keeps the
  // boundaries monotonic so every active user lands in exactly one band.
  const powerEnd = Math.round(n * 0.05);
  const heavyEnd = Math.round(n * 0.2);
  const typicalEnd = Math.round(n * 0.75);

  const buckets: Record<string, UserRow[]> = {
    power: active.slice(0, powerEnd),
    heavy: active.slice(powerEnd, heavyEnd),
    typical: active.slice(heavyEnd, typicalEnd),
    light: active.slice(typicalEnd),
    nearZero,
  };

  return USAGE_GROUP_DEFS.map((def) => {
    const members = buckets[def.key] ?? [];
    const totalQuantity = members.reduce((a, u) => a + u.totalQuantity, 0);
    return {
      ...def,
      users: members.length,
      totalQuantity,
      avgQuantity: members.length > 0 ? totalQuantity / members.length : 0,
      medianQuantity: median(members.map((u) => u.totalQuantity)),
    };
  });
}

/** Median of a list of numbers; 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Whether a model name denotes Copilot's automatic ("Auto") model selection.
 * Auto-selected models are reported with an "Auto:" prefix, e.g.
 * "Auto: GPT-5.3-Codex".
 */
function isAutoModel(model: string): boolean {
  return /^auto\s*:/i.test(model.trim());
}

interface BundledModel {
  model: string;
  quantity: number;
  /** Constituent auto-selected models - present only on the aggregated Auto entry. */
  children?: UserUsage["models"];
}

/**
 * Collapse all Auto model selections into a single "Auto" entry, preserving the
 * individual auto-selected models as `children`. Returned sorted by quantity desc.
 */
function bundleAutoModels(models: UserUsage["models"]): BundledModel[] {
  const auto = models.filter((m) => isAutoModel(m.model));
  const others: BundledModel[] = models.filter((m) => !isAutoModel(m.model));
  if (auto.length === 0) return others;
  const quantity = auto.reduce((a, m) => a + m.quantity, 0);
  const bundled: BundledModel[] = [
    ...others,
    {
      model: "Auto",
      quantity,
      children: [...auto].sort((a, b) => b.quantity - a.quantity),
    },
  ];
  return bundled.sort((a, b) => b.quantity - a.quantity);
}

/** Build a "model (1.2k AIC)" summary string, used for Auto bundle tooltips. */
function autoChildrenTitle(children: UserUsage["models"]): string {
  return children.map((c) => `${c.model} (${formatAic(c.quantity)})`).join(", ");
}

function UtilizationBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  let color = "var(--fgColor-success, #1a7f37)";
  if (pct > 100) color = "var(--fgColor-danger, #cf222e)";
  else if (pct >= 80) color = "var(--fgColor-attention, #9a6700)";
  return (
    <div className={styles.utilCell}>
      <div className={styles.utilTrack}>
        <div
          className={styles.utilFill}
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className={styles.utilPct} style={{ color }}>
        {pct > 100 && (
          <AlertIcon size={12} aria-label="Over budget" className={styles.overBudgetIcon} />
        )}
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function UserDetail({ user, budget }: { user: UserRow; budget: number }) {
  const observedPct = budget > 0 ? (user.totalQuantity / budget) * 100 : 0;
  const projectedPct = budget > 0 ? (user.projectedMonth / budget) * 100 : 0;
  const bundledModels = bundleAutoModels(user.models);
  const maxModel = bundledModels[0]?.quantity ?? 0;
  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailGrid}>
        <div>
          <div className={styles.detailHeading}>
            <CalendarIcon size={14} />
            <span>Activity</span>
          </div>
          <dl className={styles.detailList}>
            <dt>Date range</dt>
            <dd>
              {user.firstDay || "-"} → {user.lastDay || "-"}
            </dd>
            <dt>Active days</dt>
            <dd>{user.activeDays}</dd>
            <dt>Run rate</dt>
            <dd>{`${formatAic(user.runRate)}/day`}</dd>
            <dt>Projected month</dt>
            <dd>
              {formatAic(user.projectedMonth)} ({formatUsd(user.projectedMonth * USD_PER_AIC)})
            </dd>
          </dl>
        </div>

        <div>
          <div className={styles.detailHeading}>
            <span>Models ({bundledModels.length})</span>
          </div>
          {bundledModels.length === 0 ? (
            <Text className={styles.muted} style={{ fontSize: 12 }}>
              No model attribution in this report.
            </Text>
          ) : (
            <div className={styles.modelBars}>
              {bundledModels.map((m) => {
                const share = user.totalQuantity > 0 ? (m.quantity / user.totalQuantity) * 100 : 0;
                const width = maxModel > 0 ? (m.quantity / maxModel) * 100 : 0;
                const label = m.children ? `${m.model} (${m.children.length})` : m.model;
                const title = m.children ? autoChildrenTitle(m.children) : m.model;
                return (
                  <div key={m.model} className={styles.modelBarRow}>
                    <span className={styles.modelBarName} title={title}>
                      {label}
                    </span>
                    <span className={styles.modelBarTrack}>
                      <span className={styles.modelBarFill} style={{ width: `${width}%` }} />
                    </span>
                    <span className={styles.modelBarVal}>
                      {formatAic(m.quantity)} · {share.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {budget > 0 && (
          <div>
            <div className={styles.detailHeading}>
              <span>Budget</span>
            </div>
            <dl className={styles.detailList}>
              <dt>Monthly budget</dt>
              <dd>
                {formatAic(budget)} ({formatUsd(budget * USD_PER_AIC)})
              </dd>
              <dt>Used to date</dt>
              <dd>{observedPct.toFixed(0)}%</dd>
              <dt>Projected use</dt>
              <dd
                style={
                  projectedPct > 100
                    ? { color: "var(--fgColor-danger, #cf222e)", fontWeight: 600 }
                    : undefined
                }
              >
                {projectedPct.toFixed(0)}%
              </dd>
              <dt>{user.projectedMonth > budget ? "Projected overage" : "Headroom"}</dt>
              <dd>
                {user.projectedMonth > budget
                  ? `${formatAic(user.projectedMonth - budget)} (${formatUsd((user.projectedMonth - budget) * USD_PER_AIC)})`
                  : `${formatAic(budget - user.projectedMonth)} left`}
              </dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function ModelTags({ models }: { models: UserUsage["models"] }) {
  const bundled = bundleAutoModels(models);
  if (bundled.length === 0) {
    return <Text className={styles.muted} style={{ fontSize: 12 }}>-</Text>;
  }
  const shown = bundled.slice(0, 2);
  const rest = bundled.length - shown.length;
  return (
    <div className={styles.modelTags}>
      {shown.map((m) => (
        <span
          key={m.model}
          title={m.children ? autoChildrenTitle(m.children) : undefined}
        >
          <Label variant="secondary">
            {m.children ? `${m.model} (${m.children.length})` : m.model}
          </Label>
        </span>
      ))}
      {rest > 0 && (
        <span
          title={bundled
            .slice(2)
            .map((m) => `${m.model} (${formatAic(m.quantity)})`)
            .join(", ")}
        >
          <Label variant="secondary">+{rest}</Label>
        </span>
      )}
    </div>
  );
}

/** Number of bins in the mini spend-distribution histogram. */
const SPEND_HISTOGRAM_BINS = 15;

/** A single bin in the spend-distribution histogram. */
interface SpendBin {
  /** Inclusive lower bound in USD. */
  lo: number;
  /** Exclusive upper bound in USD. */
  hi: number;
  count: number;
}

/**
 * Split users into evenly sized USD spend bins for the mini histogram.
 * The range spans $0 to the highest spender; the top spender lands in the
 * last bin. Returns an empty array when there is no positive spend.
 */
function buildSpendHistogram(users: UserRow[]): SpendBin[] {
  const spends = users.map((u) => u.totalQuantity * USD_PER_AIC);
  const max = spends.length ? Math.max(...spends) : 0;
  if (max <= 0) return [];
  const width = max / SPEND_HISTOGRAM_BINS;
  const bins: SpendBin[] = Array.from({ length: SPEND_HISTOGRAM_BINS }, (_, i) => ({
    lo: i * width,
    hi: (i + 1) * width,
    count: 0,
  }));
  for (const s of spends) {
    const idx = Math.min(SPEND_HISTOGRAM_BINS - 1, Math.floor(s / width));
    bins[idx].count += 1;
  }
  return bins;
}

/** Compact USD label (whole dollars) for histogram tooltips. */
function usdShort(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * Mini bar histogram of users by total spend, shown beside the user count.
 * Each bar is a USD bin; height is the share of users in that bin.
 */
function SpendHistogram({ users }: { users: UserRow[] }) {
  const bins = useMemo(() => buildSpendHistogram(users), [users]);
  if (!bins.length) return null;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const first = bins[0];
  const mid = bins[Math.floor(bins.length / 2)];
  const last = bins[bins.length - 1];
  return (
    <div className={styles.usersCardChart}>
      <div className={styles.miniHistLabel}>Users by spend</div>
      <div
        className={styles.miniHist}
        role="img"
        aria-label="Distribution of users by total spend"
      >
        {bins.map((b, i) => (
          <div
            key={i}
            className={styles.miniHistBar}
            style={{ height: `${(b.count / max) * 100}%` }}
            title={`${usdShort(b.lo)}\u2013${usdShort(b.hi)}: ${b.count} ${b.count === 1 ? "user" : "users"}`}
          />
        ))}
      </div>
      <div className={styles.miniHistAxis}>
        <span>{usdShort(first.lo)}</span>
        <span>{usdShort(mid.lo)}</span>
        <span>{usdShort(last.hi)}</span>
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

function formatMonthEnd(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
