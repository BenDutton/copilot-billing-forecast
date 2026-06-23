"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import posthog from "posthog-js";
import { Button, Label, Text } from "@primer/react";
import { UploadIcon, FileIcon } from "@primer/octicons-react";
import { parseUsageCsv, type ParsedReport } from "@/lib/report";
import { useReport } from "@/components/report-provider";
import styles from "./app.module.css";

const REPORT_TYPE_LABELS: Record<ParsedReport["reportType"], string> = {
  summarized: "Summarized usage report",
  detailed: "Detailed usage report",
  ai: "AI usage report",
  unknown: "Usage report",
};

export function CsvUploader({ compact = false }: { compact?: boolean }) {
  const { report, setReport, clearReport } = useReport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
        toast.error("Please choose a .csv usage report.");
        return;
      }
      setBusy(true);
      try {
        const parsed = await parseUsageCsv(file);
        setReport(parsed);
        // Privacy: only non-sensitive aggregate metadata is captured here -
        // never the CSV contents, filename, or any per-user/usage data.
        posthog.capture("csv_uploaded", {
          report_type: parsed.reportType,
          row_count: parsed.rowCount,
        });
        toast.success(
          `Loaded ${parsed.rowCount.toLocaleString()} rows - ${REPORT_TYPE_LABELS[parsed.reportType]}`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to parse CSV.");
      } finally {
        setBusy(false);
      }
    },
    [setReport],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      className={styles.hidden}
      onChange={(e) => handleFile(e.target.files?.[0])}
    />
  );

  if (compact && report) {
    return (
      <div className={styles.uploaderCompact}>
        <Label size="large" className={styles.uploaderFileLabel}>
          <FileIcon />
          <span style={{ marginLeft: 4 }}>{report.fileName}</span>
        </Label>
        <Text className={styles.muted} style={{ fontSize: 12 }}>
          {report.rowCount.toLocaleString()} rows
        </Text>
        <Button size="small" onClick={() => inputRef.current?.click()} disabled={busy}>
          Replace
        </Button>
        <Button size="small" variant="invisible" onClick={clearReport} disabled={busy}>
          Clear
        </Button>
        {hiddenInput}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
      role="button"
      tabIndex={0}
      aria-label="Upload usage report CSV"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
    >
      <div className={styles.dropzoneIconWrap}>
        <UploadIcon size={24} />
      </div>
      <Text as="p" className={styles.dropzoneLabel}>
        {busy
          ? "Parsing…"
          : dragging
            ? "Drop to upload"
            : "Drop a usage report CSV here"}
      </Text>
      <Text as="p" className={styles.dropzoneSubtext}>
        or click to browse
      </Text>
      <div className={styles.dropzoneActions}>
        <Button
          className={styles.dropzoneButton}
          variant="primary"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Choose CSV file
        </Button>
      </div>
      {hiddenInput}
    </div>
  );
}
