import Papa from "papaparse";

/**
 * A single normalized row from a GitHub usage / billing report CSV.
 * See https://docs.github.com/en/billing/reference/billing-reports
 *
 * All optional fields may be absent depending on the report type
 * (summarized / detailed / AI usage).
 */
export interface UsageRow {
  date: string; // ISO-ish day string, e.g. "2026-01-31"
  product: string;
  sku: string;
  quantity: number;
  unitType: string;
  appliedCostPerQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  username?: string;
  organization?: string;
  repository?: string;
  workflowPath?: string;
  costCenterName?: string;
  model?: string;
}

export type NumericMetric = "netAmount" | "grossAmount" | "quantity";

export const METRIC_LABELS: Record<NumericMetric, string> = {
  netAmount: "Net amount (billable)",
  grossAmount: "Gross amount",
  quantity: "Quantity",
};

/** Detected shape of the uploaded report. */
export type ReportType = "summarized" | "detailed" | "ai" | "unknown";

export interface ParsedReport {
  rows: UsageRow[];
  reportType: ReportType;
  /** Distinct values useful for filtering / display. */
  columns: string[];
  fileName: string;
  rowCount: number;
}

/** Map of canonical field name -> accepted CSV header aliases (lower-cased). */
const FIELD_ALIASES: Record<keyof UsageRow, string[]> = {
  date: ["date", "usage_at", "day"],
  product: ["product"],
  sku: ["sku"],
  quantity: ["quantity"],
  unitType: ["unit_type", "unittype"],
  appliedCostPerQuantity: ["applied_cost_per_quantity", "applied_cost"],
  grossAmount: ["gross_amount", "gross"],
  discountAmount: ["discount_amount", "discount"],
  netAmount: ["net_amount", "net"],
  username: ["username", "user"],
  organization: ["organization", "org"],
  repository: ["repository", "repo"],
  workflowPath: ["workflow_path", "workflow_name", "workflow"],
  costCenterName: ["cost_center_name", "cost_center", "costcenter"],
  model: ["model"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Parse a possibly-formatted numeric cell ("$1,234.50", "", "0") into a number. */
function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toStr(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/** Build a lookup from canonical field -> actual header present in the file. */
function buildHeaderMap(headers: string[]): Partial<Record<keyof UsageRow, string>> {
  const normalized = headers.map(normalizeHeader);
  const map: Partial<Record<keyof UsageRow, string>> = {};

  (Object.keys(FIELD_ALIASES) as (keyof UsageRow)[]).forEach((field) => {
    const aliases = FIELD_ALIASES[field];
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) {
      map[field] = headers[idx];
    }
  });

  return map;
}

function detectReportType(map: Partial<Record<keyof UsageRow, string>>): ReportType {
  if (map.model) return "ai";
  if (map.workflowPath) return "detailed";
  if (map.username) return "detailed";
  if (map.sku || map.netAmount) return "summarized";
  return "unknown";
}

/**
 * Turn raw PapaParse results into a normalized {@link ParsedReport}.
 * Throws an Error with a user-friendly message if the data is unusable.
 */
function buildParsedReport(
  results: Papa.ParseResult<Record<string, string>>,
  fileName: string,
): ParsedReport {
  const headers = (results.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0) {
    throw new Error("No columns found. Is this a valid CSV usage report?");
  }

  const map = buildHeaderMap(headers);

  if (!map.date) {
    throw new Error(
      "Could not find a 'date' column. Make sure this is a GitHub usage report CSV.",
    );
  }

  const get = (row: Record<string, string>, field: keyof UsageRow) => {
    const key = map[field];
    return key ? row[key] : undefined;
  };

  const rows: UsageRow[] = [];
  for (const row of results.data) {
    const date = toStr(get(row, "date"));
    if (!date) continue;
    rows.push({
      date,
      product: toStr(get(row, "product")),
      sku: toStr(get(row, "sku")),
      quantity: toNumber(get(row, "quantity")),
      unitType: toStr(get(row, "unitType")),
      appliedCostPerQuantity: toNumber(get(row, "appliedCostPerQuantity")),
      grossAmount: toNumber(get(row, "grossAmount")),
      discountAmount: toNumber(get(row, "discountAmount")),
      netAmount: toNumber(get(row, "netAmount")),
      username: toStr(get(row, "username")) || undefined,
      organization: toStr(get(row, "organization")) || undefined,
      repository: toStr(get(row, "repository")) || undefined,
      workflowPath: toStr(get(row, "workflowPath")) || undefined,
      costCenterName: toStr(get(row, "costCenterName")) || undefined,
      model: toStr(get(row, "model")) || undefined,
    });
  }

  if (rows.length === 0) {
    throw new Error("The CSV contained no usable rows.");
  }

  return {
    rows,
    reportType: detectReportType(map),
    columns: headers,
    fileName,
    rowCount: rows.length,
  };
}

/**
 * Parse a GitHub usage report CSV entirely in the browser.
 *
 * IMPORTANT: This must only ever run on the client. The parsed data must never
 * be sent to a server or any third party.
 */
export function parseUsageCsv(file: File): Promise<ParsedReport> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      worker: false,
      complete: (results) => {
        try {
          resolve(buildParsedReport(results, file.name));
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Failed to parse CSV."));
        }
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * Parse a GitHub usage report CSV from raw text.
 *
 * Used for a build-time preloaded report (see `PRELOADED_CSV_PATH`). PapaParse
 * returns synchronously when given a string, so this runs on both the server
 * (during static export) and the client during hydration.
 */
export function parseUsageCsvText(text: string, fileName: string): ParsedReport {
  const results = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });
  return buildParsedReport(results, fileName);
}

export interface DailyPoint {
  /** Day as "YYYY-MM-DD". */
  date: string;
  /** Epoch ms at UTC midnight, useful for charting/regression. */
  t: number;
  value: number;
}

/** Sum a numeric metric per UTC day, returned sorted ascending by date. */
export function aggregateDaily(rows: UsageRow[], metric: NumericMetric): DailyPoint[] {
  const byDay = new Map<string, number>();

  for (const row of rows) {
    const day = normalizeDay(row.date);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + (row[metric] || 0));
  }

  return [...byDay.entries()]
    .map(([date, value]) => ({ date, t: Date.parse(`${date}T00:00:00Z`), value }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

/** Model usage attributed to a single user. */
export interface ModelUsage {
  model: string;
  /** AI Credits (quantity) attributed to this model. */
  quantity: number;
}

/** Aggregated AI-credit usage for a single user. */
export interface UserUsage {
  username: string;
  /** Total AI Credits (quantity) consumed. */
  totalQuantity: number;
  /** Number of distinct active days. */
  activeDays: number;
  /** Distinct models used, sorted by quantity desc. */
  models: ModelUsage[];
  /** Daily quantity series, sorted ascending - used for per-user forecasts. */
  daily: DailyPoint[];
  /** First and last observed days. */
  firstDay: string;
  lastDay: string;
}

/**
 * Group rows by username and summarize AI-credit usage, models, and a daily
 * series suitable for forecasting. Rows without a username are bucketed under
 * "(unattributed)". Returned sorted by total quantity descending.
 */
export function aggregateByUser(rows: UsageRow[]): UserUsage[] {
  interface Acc {
    total: number;
    days: Map<string, number>;
    models: Map<string, number>;
  }
  const byUser = new Map<string, Acc>();

  for (const row of rows) {
    const name = row.username || "(unattributed)";
    const day = normalizeDay(row.date);
    if (!day) continue;
    const qty = row.quantity || 0;

    let acc = byUser.get(name);
    if (!acc) {
      acc = { total: 0, days: new Map(), models: new Map() };
      byUser.set(name, acc);
    }
    acc.total += qty;
    acc.days.set(day, (acc.days.get(day) ?? 0) + qty);
    if (row.model) {
      acc.models.set(row.model, (acc.models.get(row.model) ?? 0) + qty);
    }
  }

  const users: UserUsage[] = [];
  for (const [username, acc] of byUser.entries()) {
    const daily: DailyPoint[] = [...acc.days.entries()]
      .map(([date, value]) => ({ date, t: Date.parse(`${date}T00:00:00Z`), value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);

    const models: ModelUsage[] = [...acc.models.entries()]
      .map(([model, quantity]) => ({ model, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    users.push({
      username,
      totalQuantity: acc.total,
      activeDays: acc.days.size,
      models,
      daily,
      firstDay: daily.length ? daily[0].date : "",
      lastDay: daily.length ? daily[daily.length - 1].date : "",
    });
  }

  return users.sort((a, b) => b.totalQuantity - a.totalQuantity);
}

/** Aggregated AI-credit usage for a single model. */
export interface ModelSummary {
  model: string;
  /** Total AI Credits (quantity) attributed to this model. */
  totalQuantity: number;
  /** Fraction of the grand total, 0..1. */
  share: number;
  /** Number of distinct users that used this model. */
  users: number;
  /** Daily quantity series, sorted ascending - used for per-model trends. */
  daily: DailyPoint[];
  firstDay: string;
  lastDay: string;
}

/**
 * Group rows by model and summarize AI-credit usage, distinct users, and a daily
 * series. Rows without a model are skipped. Returned sorted by total quantity desc.
 */
export function aggregateByModel(rows: UsageRow[]): ModelSummary[] {
  interface Acc {
    total: number;
    days: Map<string, number>;
    users: Set<string>;
  }
  const byModel = new Map<string, Acc>();
  let grandTotal = 0;

  for (const row of rows) {
    if (!row.model) continue;
    const day = normalizeDay(row.date);
    if (!day) continue;
    const qty = row.quantity || 0;
    grandTotal += qty;

    let acc = byModel.get(row.model);
    if (!acc) {
      acc = { total: 0, days: new Map(), users: new Set() };
      byModel.set(row.model, acc);
    }
    acc.total += qty;
    acc.days.set(day, (acc.days.get(day) ?? 0) + qty);
    if (row.username) acc.users.add(row.username);
  }

  const models: ModelSummary[] = [];
  for (const [model, acc] of byModel.entries()) {
    const daily: DailyPoint[] = [...acc.days.entries()]
      .map(([date, value]) => ({ date, t: Date.parse(`${date}T00:00:00Z`), value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);

    models.push({
      model,
      totalQuantity: acc.total,
      share: grandTotal > 0 ? acc.total / grandTotal : 0,
      users: acc.users.size,
      daily,
      firstDay: daily.length ? daily[0].date : "",
      lastDay: daily.length ? daily[daily.length - 1].date : "",
    });
  }

  return models.sort((a, b) => b.totalQuantity - a.totalQuantity);
}

/** Aggregated AI-credit usage for a single cost center. */
export interface CostCenterSummary {
  /** Cost center name, or "(no cost center)" for unattributed rows. */
  name: string;
  /** Total AI Credits (quantity) attributed to this cost center. */
  totalQuantity: number;
  /** Fraction of the grand total, 0..1. */
  share: number;
  /** Number of distinct users in this cost center. */
  users: number;
  /** Number of distinct models used in this cost center. */
  models: number;
  /** Number of distinct active days. */
  activeDays: number;
  /** Daily quantity series, sorted ascending - used for trends/forecasts. */
  daily: DailyPoint[];
  firstDay: string;
  lastDay: string;
}

/**
 * Group rows by cost center and summarize AI-credit usage, distinct users and
 * models, and a daily series. Rows without a cost center are bucketed under
 * "(no cost center)". Returned sorted by total quantity descending.
 */
export function aggregateByCostCenter(rows: UsageRow[]): CostCenterSummary[] {
  interface Acc {
    total: number;
    days: Map<string, number>;
    users: Set<string>;
    models: Set<string>;
  }
  const byCenter = new Map<string, Acc>();
  let grandTotal = 0;

  for (const row of rows) {
    const day = normalizeDay(row.date);
    if (!day) continue;
    const name = row.costCenterName || "(no cost center)";
    const qty = row.quantity || 0;
    grandTotal += qty;

    let acc = byCenter.get(name);
    if (!acc) {
      acc = { total: 0, days: new Map(), users: new Set(), models: new Set() };
      byCenter.set(name, acc);
    }
    acc.total += qty;
    acc.days.set(day, (acc.days.get(day) ?? 0) + qty);
    if (row.username) acc.users.add(row.username);
    if (row.model) acc.models.add(row.model);
  }

  const centers: CostCenterSummary[] = [];
  for (const [name, acc] of byCenter.entries()) {
    const daily: DailyPoint[] = [...acc.days.entries()]
      .map(([date, value]) => ({ date, t: Date.parse(`${date}T00:00:00Z`), value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);

    centers.push({
      name,
      totalQuantity: acc.total,
      share: grandTotal > 0 ? acc.total / grandTotal : 0,
      users: acc.users.size,
      models: acc.models.size,
      activeDays: acc.days.size,
      daily,
      firstDay: daily.length ? daily[0].date : "",
      lastDay: daily.length ? daily[daily.length - 1].date : "",
    });
  }

  return centers.sort((a, b) => b.totalQuantity - a.totalQuantity);
}

/**
 * Build a per-day breakdown of quantity grouped by username and by model.
 * Useful for attributing a spike day to its top contributors.
 */
export function dayContributions(rows: UsageRow[]): Map<
  string,
  { byUser: Map<string, number>; byModel: Map<string, number> }
> {
  const byDay = new Map<string, { byUser: Map<string, number>; byModel: Map<string, number> }>();
  for (const row of rows) {
    const day = normalizeDay(row.date);
    if (!day) continue;
    const qty = row.quantity || 0;
    let entry = byDay.get(day);
    if (!entry) {
      entry = { byUser: new Map(), byModel: new Map() };
      byDay.set(day, entry);
    }
    if (row.username) entry.byUser.set(row.username, (entry.byUser.get(row.username) ?? 0) + qty);
    if (row.model) entry.byModel.set(row.model, (entry.byModel.get(row.model) ?? 0) + qty);
  }
  return byDay;
}

/** Normalize various date strings to "YYYY-MM-DD" (UTC). */
export function normalizeDay(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Already ISO date or datetime.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Other formats (e.g. "1/31/2026") are parsed as local time. Read the calendar
  // day back in local time too, so a midnight value isn't rolled to the previous
  // day by a UTC conversion in timezones ahead of UTC.
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function sumMetric(rows: UsageRow[], metric: NumericMetric): number {
  return rows.reduce((acc, r) => acc + (r[metric] || 0), 0);
}

export function formatMetric(value: number, metric: NumericMetric): string {
  if (metric === "quantity") {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
