"use client";

import posthog from "posthog-js";
import {
  LinkExternalIcon,
  MegaphoneIcon,
  MortarBoardIcon,
  BookIcon,
  DeviceCameraVideoIcon,
  RocketIcon,
  MarkGithubIcon,
} from "@primer/octicons-react";
import { getToolsByCategory, CATEGORY_COLOR as TOOL_CATEGORY_COLOR, type ToolCategory } from "@/lib/tools";
import styles from "./app.module.css";

/** Short commit SHA of the deployed build, baked in at build time. */
const COMMIT_SHA = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "").trim().slice(0, 7);
/** Accent color per sidebar section, keyed by category (Resources is sidebar-only). */
const CATEGORY_COLOR: Record<ToolCategory | "Resources", string> = {
  ...TOOL_CATEGORY_COLOR,
  Resources: "#1a7f37",
};

/** Resource grouping, in display order. */
type ResourceCategory = "News" | "Courses & guides" | "Videos";

const RESOURCE_CATEGORIES: ResourceCategory[] = ["News", "Courses & guides", "Videos"];

const RESOURCES: {
  label: string;
  description: string;
  href: string;
  icon: typeof MegaphoneIcon;
  category: ResourceCategory;
}[] = [
  {
    label: "Copilot usage-based billing",
    description: "What's changing, in brief",
    href: "https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/",
    icon: MegaphoneIcon,
    category: "News",
  },
  {
    label: "GitHub Changelog",
    description: "Latest product updates",
    href: "https://github.blog/changelog/",
    icon: MarkGithubIcon,
    category: "News",
  },
  {
    label: "Budgeting quick course",
    description: "GitHub usage-based billing module",
    href: "https://learn.github.com/courses/gitHubusagebasedbillingmodule",
    icon: MortarBoardIcon,
    category: "Courses & guides",
  },
  {
    label: "Managing AI credits",
    description: "Well-Architected guidelines",
    href: "https://wellarchitected.github.com/library/governance/recommendations/managing-ai-credits/",
    icon: BookIcon,
    category: "Courses & guides",
  },
  {
    label: "Optimize AI credit usage",
    description: "VS Code guide (applies broadly)",
    href: "https://code.visualstudio.com/docs/copilot/guides/optimize-usage",
    icon: RocketIcon,
    category: "Courses & guides",
  },
  {
    label: "Token optimisation webinar",
    description: "Make the most of your budget",
    href: "https://www.youtube.com/watch?v=LeALSSsbzHU",
    icon: DeviceCameraVideoIcon,
    category: "Videos",
  },
];

export function Sidebar({
  activeId,
  onSelect,
  toolsDisabled = false,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  toolsDisabled?: boolean;
}) {
  const groups = getToolsByCategory();
  return (
    <nav className={styles.sidebarWrap} aria-label="Tools">
      <div className={styles.toolGroups}>
        {groups.map(({ category, tools }) => (
          <div
            key={category}
            className={styles.toolGroup}
            style={{ ["--group-color" as string]: CATEGORY_COLOR[category] }}
          >
            <div className={styles.sidebarHeading}>{category}</div>
            <ul className={styles.toolList}>
              {tools.map((tool) => {
                const active = tool.id === activeId;
                const disabled = toolsDisabled || !tool.enabled;
                return (
                  <li
                    key={tool.id}
                    className={disabled ? styles.toolItemLocked : undefined}
                    data-tip={toolsDisabled ? "Upload a usage report to use this tool" : undefined}
                  >
                    <button
                      type="button"
                      className={`${styles.toolItem} ${active ? styles.toolItemActive : ""}`}
                      aria-current={active ? "page" : undefined}
                      disabled={disabled}
                      onClick={() => !disabled && onSelect(tool.id)}
                    >
                      <span className={styles.toolIcon}>
                        <tool.icon size={16} />
                      </span>
                      <span className={styles.toolText}>
                        <span className={styles.toolLabel}>{tool.label}</span>
                        <span className={styles.toolDesc}>{tool.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div
        className={styles.resources}
        style={{ ["--group-color" as string]: CATEGORY_COLOR.Resources }}
      >
        <div className={styles.sidebarHeading}>Resources</div>
        {RESOURCE_CATEGORIES.map((category) => {
          const items = RESOURCES.filter((r) => r.category === category);
          if (items.length === 0) return null;
          return (
            <div key={category} className={styles.resourceGroup}>
              <div className={styles.resourceSubheading}>{category}</div>
              <ul className={styles.toolList}>
                {items.map((r) => (
                  <li key={r.href}>
                    <a
                      className={styles.resourceItem}
                      href={r.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        // Privacy: only the curated, public resource label/category
                        // are captured - never any report or per-user data.
                        posthog.capture("resource_clicked", {
                          resource_label: r.label,
                          resource_category: r.category,
                        })
                      }
                    >
                      <span className={styles.toolIcon}>
                        <r.icon size={16} />
                      </span>
                      <span className={styles.toolText}>
                        <span className={styles.toolLabel}>
                          {r.label}
                          <LinkExternalIcon size={12} className={styles.resourceExternal} />
                        </span>
                        <span className={styles.toolDesc}>{r.description}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className={styles.buildInfo}>
        <a
          href="https://github.com/BenDutton/copilot-billing-forecast"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            // Privacy: only a fixed link location is captured - never any
            // report or per-user data.
            posthog.capture("github_link_clicked", { link_location: "sidebar-source" })
          }
        >
          Open source on GitHub
        </a>
        <span className={styles.buildInfoSep} aria-hidden="true">
          ·
        </span>
        {COMMIT_SHA ? (
            <span>build {COMMIT_SHA}</span>
        ) : (
          <span>development</span>
        )}
      </div>
    </nav>
  );
}
