"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { parseUsageCsvText, type ParsedReport } from "@/lib/report";

/**
 * Optional report shipped with the build. Drop a CSV at
 * `public/preloaded-report.csv` and it is fetched on load, parsed, and locked
 * so users cannot upload, replace, or clear it. Absent the file, the app
 * behaves normally. The base path keeps the URL correct under GitHub Pages.
 */
const PRELOADED_REPORT_FILE = "preloaded-report.csv";
const PRELOADED_REPORT_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/${PRELOADED_REPORT_FILE}`;

interface ReportContextValue {
  report: ParsedReport | null;
  setReport: (report: ParsedReport | null) => void;
  clearReport: () => void;
  /**
   * True when the report was preloaded with the build. In this mode the user
   * cannot upload, replace, or clear the report.
   */
  locked: boolean;
  /** True while the optional preloaded report is being probed on first load. */
  loading: boolean;
}

const ReportContext = createContext<ReportContextValue | null>(null);

/**
 * Holds the parsed usage report in memory on the client only.
 * The data never leaves the browser and is not persisted server-side.
 *
 * On mount it probes for an optional preloaded report (see
 * {@link PRELOADED_REPORT_URL}); if present, that report is loaded and locked.
 */
export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(PRELOADED_REPORT_URL, { signal: controller.signal });
        // A missing file yields a 404 (or the SPA fallback HTML); fall back to
        // the normal upload flow in either case.
        if (!res.ok) return;
        if ((res.headers.get("content-type") ?? "").includes("text/html")) return;
        const text = await res.text();
        const parsed = parseUsageCsvText(text, PRELOADED_REPORT_FILE);
        setReport(parsed);
        setLocked(true);
      } catch {
        // No preloaded report, or it could not be parsed: normal upload mode.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const value = useMemo<ReportContextValue>(
    () => ({
      report,
      // In locked mode the report is fixed; ignore attempts to change it.
      setReport: locked ? () => {} : setReport,
      clearReport: locked ? () => {} : () => setReport(null),
      locked,
      loading,
    }),
    [report, locked, loading],
  );

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

export function useReport(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) {
    throw new Error("useReport must be used within a ReportProvider");
  }
  return ctx;
}
