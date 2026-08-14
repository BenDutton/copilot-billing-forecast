"use client";

import { ArrowUpIcon, ArrowDownIcon, CacheIcon } from "@primer/octicons-react";
import styles from "./app.module.css";

/**
 * Color coding for token types, shared across the model-breakdown and
 * team-insights tools so token visuals stay consistent between them.
 */
export const TOKEN_COLORS = {
  input: "#0969da",
  output: "#8250df",
  cache: "#1a7f37",
} as const;

/** Compact token count, e.g. "1.2M". */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Full input/output/cache breakdown text for a token tooltip. */
export function tokenBreakdownText({
  input,
  output,
  cacheRead,
  cacheWrite,
}: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): string {
  const nf = new Intl.NumberFormat();
  return [
    `Input: ${nf.format(input)}`,
    `Output: ${nf.format(output)}`,
    `Cache read: ${nf.format(cacheRead)}`,
    `Cache write: ${nf.format(cacheWrite)}`,
  ].join(" · ");
}

/**
 * Compact, color-coded inline breakdown of input/output/cached token counts,
 * e.g. "↓1.8M ↑900K ⚡400K". Used to annotate a token total without taking up
 * much horizontal space - full precision is available via the enclosing
 * tooltip.
 */
export function TokenParts({
  input,
  output,
  cached,
}: {
  input: number;
  output: number;
  cached: number;
}) {
  return (
    <span className={styles.tokenParts}>
      <span className={styles.tokenPart} style={{ color: TOKEN_COLORS.input }}>
        <ArrowDownIcon size={10} fill={TOKEN_COLORS.input} />
        {formatTokens(input)}
      </span>
      <span className={styles.tokenPart} style={{ color: TOKEN_COLORS.output }}>
        <ArrowUpIcon size={10} fill={TOKEN_COLORS.output} />
        {formatTokens(output)}
      </span>
      <span className={styles.tokenPart} style={{ color: TOKEN_COLORS.cache }}>
        <CacheIcon size={10} fill={TOKEN_COLORS.cache} />
        {formatTokens(cached)}
      </span>
    </span>
  );
}
