"use client";

import { useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { Flash, Header, Heading, IconButton, Label, Spinner, Text, Timeline } from "@primer/react";
import {
  CopilotIcon,
  CreditCardIcon,
  DownloadIcon,
  GearIcon,
  GraphIcon,
  MarkGithubIcon,
  ShieldLockIcon,
  ThreeBarsIcon,
} from "@primer/octicons-react";
import { Sidebar } from "@/components/sidebar";
import { CsvUploader } from "@/components/csv-uploader";
import { ReportProvider, useReport } from "@/components/report-provider";
import { DEFAULT_TOOL_ID, getTool, getToolColor } from "@/lib/tools";
import styles from "./app.module.css";

function Shell() {
  const [activeId, setActiveId] = useState(DEFAULT_TOOL_ID);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { report, loading } = useReport();
  const tool = getTool(activeId);
  const ActiveView = tool?.component;
  const toolColor = getToolColor(activeId);

  // When a report first loads, the active tool's view appears without a click,
  // so emit a tool_viewed for it once on that transition.
  const hadReport = useRef(false);
  useEffect(() => {
    const hasReport = !!report;
    if (hasReport && !hadReport.current && tool?.enabled) {
      // Privacy: only the stable tool id (a fixed enum) is captured - never any
      // report contents or per-user data. Disabled tools never emit events.
      posthog.capture("tool_viewed", { tool_id: activeId });
    }
    hadReport.current = hasReport;
  }, [report, activeId, tool]);

  const handleSelect = (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    // Privacy: only the stable tool id (a fixed enum) is captured - never any
    // report contents or per-user data. Disabled tools and the pre-upload
    // state (no report loaded) never emit events.
    if (report && getTool(id)?.enabled) {
      posthog.capture("tool_viewed", { tool_id: id });
    }
  };

  return (
    <div className={styles.appRoot}>
      <Header className={styles.header}>
        <Header.Item className={styles.menuToggle}>
          <IconButton
            icon={ThreeBarsIcon}
            aria-label={sidebarOpen ? "Hide tools" : "Show tools"}
            aria-expanded={sidebarOpen}
            variant="invisible"
            onClick={() => setSidebarOpen((o) => !o)}
            style={{ color: "var(--fgColor-onEmphasis, #fff)" }}
          />
        </Header.Item>
        <Header.Item>
          <Header.Link
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleSelect(DEFAULT_TOOL_ID);
            }}
          >
            <MarkGithubIcon size={28} />
            <span className={styles.headerBrand} style={{ marginLeft: 8 }}>
              Copilot Billing Forecast
            </span>
          </Header.Link>
        </Header.Item>
        <Header.Item full>
          <Text style={{ color: "var(--fgColor-onEmphasis, #fff)", opacity: 0.7, fontSize: 14 }}>
            Analyze &amp; forecast GitHub Copilot AI usage and spend
          </Text>
        </Header.Item>
      </Header>

      <div className={styles.appBody}>
        <aside className={`${styles.pane} ${sidebarOpen ? styles.paneOpen : ""}`}>
          <Sidebar activeId={activeId} onSelect={handleSelect} toolsDisabled={!report} />
        </aside>
        {sidebarOpen && (
          <div
            className={styles.paneBackdrop}
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        <main className={styles.main}>
          {report && (
            <div
              className={styles.contentBand}
              style={{ ["--group-color" as string]: toolColor }}
            >
              <div className={styles.contentBandTitle}>
                <div className={styles.contentBandHeading}>
                  <Heading as="h1" style={{ fontSize: 20 }}>
                    {tool?.label ?? "Toolbox"}
                  </Heading>
                  {tool && (
                    <Label
                      size="small"
                      style={{
                        borderColor: toolColor,
                        color: toolColor,
                      }}
                    >
                      {tool.category}
                    </Label>
                  )}
                </div>
                <Text className={styles.muted} style={{ fontSize: 14 }}>
                  {tool?.description}
                </Text>
              </div>
              <CsvUploader compact />
            </div>
          )}

          <div className={styles.contentInner}>
            {loading ? (
              <div className={styles.promptShell}>
                <Spinner size="large" aria-label="Loading report" />
              </div>
            ) : !report ? (
              <GlobalUploadPrompt />
            ) : ActiveView ? (
              <div key={activeId} className={styles.toolView}>
                <ActiveView />
              </div>
            ) : (
              <Text>Unknown tool.</Text>
            )}
            <footer className={styles.disclaimer}>
              <Text as="p" className={styles.muted} style={{ fontSize: 12, lineHeight: 1.5 }}>
                <strong>Disclaimer:</strong> This is not an official GitHub product. It is an
                unofficial tool to help customers analyze and forecast their GitHub Copilot AI
                usage and spend. All processing happens locally in your browser and your data
                never leaves your device. Figures are estimates and may differ from your
                official GitHub billing; always refer to your GitHub billing statements as the
                source of truth. Provided &ldquo;as is&rdquo;, without warranty of any kind -
                use at your own risk.
              </Text>
              <Text as="p" className={styles.muted} style={{ fontSize: 12, marginTop: 8 }}>
                Open source on{" "}
                <a
                  href="https://github.com/BenDutton/copilot-billing-forecast"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    // Privacy: only a fixed link location is captured - never any
                    // report or per-user data.
                    posthog.capture("github_link_clicked", { link_location: "footer-source" })
                  }
                >
                  GitHub
                </a>
                {" "}- contributions welcome.
              </Text>
              <Text as="p" className={styles.muted} style={{ fontSize: 12, marginTop: 8 }}>
                Something is not right?{" "}
                <a
                  href="https://github.com/BenDutton/copilot-billing-forecast/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    posthog.capture("github_link_clicked", { link_location: "footer-issue" })
                  }
                >
                  Submit an issue
                </a>
                .
              </Text>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function GlobalUploadPrompt() {
  return (
    <div className={styles.promptShell}>
      <div className={styles.promptCard}>
        <div className={styles.promptCopy}>
          <Text className={styles.promptEyebrow}>Get started</Text>
          <Heading as="h2" className={styles.promptHeading}>
            Upload your GitHub AI usage report CSV.
          </Heading>
          <Text as="p" className={styles.promptLead}>
            Analyze spend, forecast AI Credit consumption, and surface usage spikes.
          </Text>
          <details className={styles.promptDetails}>
            <summary className={styles.promptSummary}>How do I get my usage report?</summary>
            <Text as="p" className={styles.muted} style={{ margin: "10px 0 4px", fontSize: 13, lineHeight: 1.5 }}>
              In <strong>GitHub Enterprise</strong>, follow these steps:
            </Text>
            <Timeline className={styles.promptTimeline}>
              <Timeline.Item condensed>
                <Timeline.Badge>
                  <GearIcon />
                </Timeline.Badge>
                <Timeline.Body>
                  Open your <strong>enterprise settings</strong>.
                </Timeline.Body>
              </Timeline.Item>
              <Timeline.Item condensed>
                <Timeline.Badge>
                  <CreditCardIcon />
                </Timeline.Badge>
                <Timeline.Body>
                  Choose <strong>Billing and licensing</strong>.
                </Timeline.Body>
              </Timeline.Item>
              <Timeline.Item condensed>
                <Timeline.Badge>
                  <GraphIcon />
                </Timeline.Badge>
                <Timeline.Body>
                  Select <strong>Usage</strong>.
                </Timeline.Body>
              </Timeline.Item>
              <Timeline.Item condensed>
                <Timeline.Badge>
                  <CopilotIcon />
                </Timeline.Badge>
                <Timeline.Body>
                  Open <strong>AI usage</strong>.
                </Timeline.Body>
              </Timeline.Item>
              <Timeline.Item condensed>
                <Timeline.Badge>
                  <DownloadIcon />
                </Timeline.Badge>
                <Timeline.Body>
                  Press <strong>Get usage report</strong>.
                </Timeline.Body>
              </Timeline.Item>
            </Timeline>
            <Text as="p" className={styles.promptReference}>
              Reference: <a href="https://docs.github.com/en/enterprise-cloud@latest/billing/reference/billing-reports" target="_blank" rel="noopener noreferrer">GitHub billing reports docs</a>
            </Text>
          </details>
        </div>

        <div className={styles.promptUpload}>
          <CsvUploader />
        </div>
      </div>

      <Flash variant="default" className={styles.promptAlert}>
        <ShieldLockIcon size={20} />
        <Text as="p" className={styles.promptAlertText}>
          Your CSV is processed locally and never leaves this browser.
        </Text>
      </Flash>
    </div>
  );
}

export function AppShell() {
  return (
    <ReportProvider>
      <Shell />
    </ReportProvider>
  );
}
