"use client";

import { ArrowUpRightIcon, ArrowDownRightIcon, DashIcon } from "@primer/octicons-react";
import styles from "./app.module.css";

/**
 * Compact "vs last month" delta shown inside a stat card or table cell once a
 * previous-period report has been added. Renders nothing when there is no
 * previous value.
 *
 * `tone="spend"` colours an increase red and a decrease green (more / less
 * spend); `tone="neutral"` stays grey for counts where neither direction is
 * inherently good or bad. With `compact`, only the arrow and percentage are
 * shown (for table cells whose column header already says "vs last month").
 * `format` is used for the hover title that reveals the previous absolute value.
 *
 * Both inputs come from the two in-memory reports; nothing is persisted or sent.
 */
export function ComparisonDelta({
  current,
  previous,
  tone = "spend",
  compact = false,
  format,
}: {
  current: number;
  previous: number | null | undefined;
  tone?: "spend" | "neutral";
  compact?: boolean;
  format?: (n: number) => string;
}) {
  if (previous == null) return null;

  const delta = current - previous;
  const rising = delta > 1e-9;
  const falling = delta < -1e-9;
  const pct = previous === 0 ? null : delta / previous;

  const Icon = rising ? ArrowUpRightIcon : falling ? ArrowDownRightIcon : DashIcon;
  const toneClass =
    tone === "neutral" ? "" : rising ? styles.deltaUp : falling ? styles.deltaDown : "";
  const pctLabel =
    pct === null
      ? current > 0
        ? "new"
        : "no change"
      : `${pct > 0 ? "+" : ""}${Math.round(pct * 100)}%`;
  const title = format ? `Last month: ${format(previous)}` : undefined;

  return (
    <span className={`${styles.comparisonDelta} ${toneClass}`} title={title}>
      <Icon size={12} />
      {compact ? pctLabel : `${pctLabel} vs last month`}
    </span>
  );
}
