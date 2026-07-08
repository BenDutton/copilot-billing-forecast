"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Heading, Label, Link, Text } from "@primer/react";
import {
  AlertIcon,
  GlobeIcon,
  InfoIcon,
  LawIcon,
  LightBulbIcon,
  LinkExternalIcon,
  OrganizationIcon,
  PeopleIcon,
  PersonIcon,
  ShieldCheckIcon,
  StopIcon,
  type Icon,
} from "@primer/octicons-react";
import styles from "../app.module.css";

/**
 * Opinionated, read-only guidance for configuring GitHub Copilot budgets.
 * Grounded in the GitHub docs (see the References section); all figures are
 * examples - always confirm against your enterprise settings and billing.
 */

// ---------------------------------------------------------------------------
// React Flow: "How every Copilot request is evaluated"
// ---------------------------------------------------------------------------

type FlowTone = "start" | "neutral" | "good" | "warn" | "bad";

interface StageData {
  title: string;
  subtitle?: string;
  tone: FlowTone;
}

/** A single stage in the request-evaluation flow. */
function StageNode({ data }: NodeProps) {
  const d = data as unknown as StageData;
  const handleStyle = { opacity: 0, width: 6, height: 6 } as const;
  const accent = d.tone === "neutral" ? "" : styles[`fnode_${d.tone}`];
  return (
    <div className={`${styles.fnode} ${accent}`}>
      <Handle type="target" position={Position.Top} id="t-top" isConnectable={false} style={handleStyle} />
      <Handle type="target" position={Position.Left} id="t-left" isConnectable={false} style={handleStyle} />
      <div className={styles.fnodeTitle}>
        {d.tone === "start" ? <span className={styles.startDot} aria-hidden="true" /> : null}
        {d.title}
      </div>
      {d.subtitle ? <div className={styles.fnodeSub}>{d.subtitle}</div> : null}
      <Handle type="source" position={Position.Bottom} id="s-bottom" isConnectable={false} style={handleStyle} />
      {/* Three right-side outlets so the metered node's fan-out edges start apart. */}
      <Handle type="source" position={Position.Right} id="s-right-top" isConnectable={false} style={{ ...handleStyle, top: "30%" }} />
      <Handle type="source" position={Position.Right} id="s-right" isConnectable={false} style={{ ...handleStyle, top: "50%" }} />
      <Handle type="source" position={Position.Right} id="s-right-bottom" isConnectable={false} style={{ ...handleStyle, top: "70%" }} />
    </div>
  );
}

const nodeTypesDef: NodeTypes = { stage: StageNode };
const FIT_VIEW_OPTIONS = { padding: 0.16 } as const;
const PRO_OPTIONS = { hideAttribution: false } as const;

const stage = (
  id: string,
  x: number,
  y: number,
  data: StageData,
): Node => ({
  id,
  type: "stage",
  position: { x, y },
  data: data as unknown as Record<string, unknown>,
  draggable: false,
  selectable: false,
  connectable: false,
});

const FLOW_NODES: Node[] = [
  // Decision spine (left column, top → bottom). Metered sits low so it lines up
  // with the middle outcome, letting the three metered edges fan symmetrically.
  stage("req", 0, 0, { title: "Copilot request", subtitle: "An AI-credit feature is used", tone: "start" }),
  stage("ulb", 0, 110, { title: "User-level budget", subtitle: "Always enforced · hard stop", tone: "neutral" }),
  stage("pool", 0, 235, { title: "Shared AI-credit pool", subtitle: "Included with your licenses", tone: "neutral" }),
  stage("metered", 0, 440, { title: "Metered budgets", subtitle: "Cost center → org → enterprise", tone: "neutral" }),
  // Outcomes (right column), aligned to the decision they follow.
  stage("blockedUlb", 280, 110, { title: "Blocked", subtitle: "Raise the user's ULB to unblock", tone: "bad" }),
  stage("served", 280, 235, { title: "Drawn from included pool", subtitle: "Included with your licenses", tone: "good" }),
  stage("paid", 280, 320, { title: "Charged as overage", subtitle: "Metered, on top of the pool", tone: "good" }),
  stage("blocked2", 280, 440, { title: "Blocked", subtitle: "“Stop usage” is ON", tone: "bad" }),
  stage("continue2", 280, 560, { title: "Charges continue", subtitle: "“Stop usage” is OFF", tone: "warn" }),
];

const C = { neutral: "#8c959f", bad: "#cf222e", good: "#1a7f37", warn: "#9a6700" } as const;

const edge = (
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  label: string,
): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  label,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: C.neutral },
  style: { stroke: C.neutral, strokeWidth: 1.5 },
  labelStyle: { fontSize: 11, fill: "var(--fgColor-muted, #59636e)", fontWeight: 500 },
  labelBgStyle: { fill: "var(--bgColor-default, #ffffff)", fillOpacity: 0.95 },
  labelBgPadding: [4, 2],
  labelBgBorderRadius: 4,
});

const FLOW_EDGES: Edge[] = [
  // Spine (top → bottom).
  edge("e1", "req", "ulb", "s-bottom", "t-top", ""),
  edge("e2", "ulb", "pool", "s-bottom", "t-top", "Within budget"),
  edge("e3", "pool", "metered", "s-bottom", "t-top", "Pool empty"),
  // Outcomes branch to the right column.
  edge("e4", "ulb", "blockedUlb", "s-right", "t-left", "Over budget"),
  edge("e5", "pool", "served", "s-right", "t-left", "Credits remain"),
  // Metered node fans out from three stacked outlets so the lines stay separate.
  edge("e6", "metered", "paid", "s-right-top", "t-left", "Budget remains"),
  edge("e7", "metered", "blocked2", "s-right", "t-left", "Exhausted"),
  edge("e8", "metered", "continue2", "s-right-bottom", "t-left", "Exhausted"),
];

function RequestFlow() {
  // Memoize so React Flow keeps a single stable reference (and stops warning in dev).
  const nodeTypes = useMemo(() => nodeTypesDef, []);
  return (
    <div className={styles.flowWrap}>
      <ReactFlow
        nodes={FLOW_NODES}
        edges={FLOW_EDGES}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={PRO_OPTIONS}
        aria-label="Diagram of how a Copilot request is evaluated against budgets"
      >
        <Background gap={16} color="#eaeef2" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static guidance content
// ---------------------------------------------------------------------------

interface UseCase {
  icon: typeof PeopleIcon;
  title: string;
  featured?: boolean;
  /** Optional pill shown next to the title (e.g. a “Start here” cue). */
  badge?: string;
  controls: string[];
  situation: string;
  steps: { glyph: BudgetGlyph; text: string }[];
  note?: string;
}

/** Budget-control types, each with a glyph so steps are scannable at a glance. */
type BudgetGlyph = "ulb" | "costCenter" | "enterprise" | "org" | "included" | "stop";

const GLYPH: Record<BudgetGlyph, { icon: Icon; label: string }> = {
  ulb: { icon: PersonIcon, label: "User-level budget" },
  costCenter: { icon: OrganizationIcon, label: "Cost center" },
  enterprise: { icon: GlobeIcon, label: "Enterprise budget" },
  org: { icon: PeopleIcon, label: "Organization budget" },
  included: { icon: ShieldCheckIcon, label: "Included-usage control" },
  stop: { icon: StopIcon, label: "Stop usage" },
};

const USE_CASES: UseCase[] = [
  {
    icon: PeopleIcon,
    title: "Prevent overages & the noisy-neighbour problem",
    featured: true,
    badge: "Start here",
    controls: ["Universal ULB", "Individual overrides", "Enterprise budget"],
    situation:
      "Stop any single user from draining the shared pool or running up surprise metered charges, while still letting heavier users work.",
    steps: [
      { glyph: "ulb", text: "Set a universal user-level budget a little above the per-license credit value, so pooling still works but no one user can consume it all." },
      { glyph: "ulb", text: "Add individual ULB overrides for the few known power users who need more." },
      { glyph: "enterprise", text: "Keep an enterprise budget as a failsafe for metered charges." },
      { glyph: "stop", text: "Enable “Stop usage when budget limit is reached” on the enterprise budget." },
    ],
    note: "The simplest configuration — a good starting point for most enterprises.",
  },
  {
    icon: OrganizationIcon,
    title: "Isolate each cost center (including overages)",
    controls: ["Cost centers", "Included-usage control", "Cost center budget", "Enterprise failsafe"],
    situation:
      "Give each team its own self-contained budget so heavy use by one team never eats another team's share of the pool — and each team owns its overages.",
    steps: [
      { glyph: "costCenter", text: "Create a cost center per team and assign users (or enterprise teams) directly, not just organizations." },
              { glyph: "included", text: "Turn on the included-usage control (set ai_credit_pool_enabled = true via the cost centers REST API) so the team can only draw the pool its own licenses fund." },
      { glyph: "included", text: "At that cap, choose to block the team or let usage continue as paid overage." },
      { glyph: "costCenter", text: "Set a cost center budget to cap the team's metered charges, and enable “Stop usage”." },
      { glyph: "costCenter", text: "Optionally enable cost center exclusion so the team spends independently of the enterprise budget." },
      { glyph: "enterprise", text: "Keep an enterprise budget as a failsafe for anyone not in a cost center." },
    ],
    note: "See the ai_credit_pool_enabled reference below.",
  },
  {
    icon: LawIcon,
    title: "Different per-user limits by team",
    controls: ["Cost centers", "Cost center ULB", "Individual overrides", "Enterprise budget"],
    situation:
      "Give departments different per-user caps (e.g. $20/user for engineering, $5/user for marketing) without managing thousands of individual budgets.",
    steps: [
      { glyph: "costCenter", text: "Create a cost center per department and assign users directly." },
      { glyph: "ulb", text: "Set a cost center user-level budget (one per-user amount) on each cost center." },
      { glyph: "ulb", text: "Add individual ULB overrides for specific exceptions." },
      { glyph: "enterprise", text: "Keep an enterprise budget failsafe with “Stop usage” enabled." },
    ],
    note: "A cost center user-level budget overrides the universal ULB for its members.",
  },
  {
    icon: PersonIcon,
    title: "Delegate control to organization owners",
    controls: ["Organization budgets", "Enterprise budget"],
    situation:
      "Let organization owners set their own guardrails without involving an enterprise admin.",
    steps: [
      { glyph: "org", text: "Each organization owner sets an organization budget." },
      { glyph: "enterprise", text: "The enterprise admin sets an enterprise budget as a safety net." },
      { glyph: "stop", text: "Enable “Stop usage when budget limit is reached” on every budget." },
    ],
    note: "Unpredictable if users hold licenses in multiple orgs — prefer cost centers with direct assignment.",
  },
];

function GuidanceMain() {
  return (
    <div className={styles.guidanceMain}>
      {/* Start here */}
      <section className={styles.guidanceHero}>
        <div className={styles.guidanceHeroHead}>
          <span className={styles.guidanceHeroIcon}>
            <LightBulbIcon size={20} />
          </span>
          <div>
            <Label variant="success">Start here · do this first</Label>
            <Heading as="h2" className={styles.guidanceHeroTitle}>
              Always set a universal user-level budget and an enterprise budget
            </Heading>
          </div>
        </div>
        <Text as="p" className={styles.guidanceHeroLead}>
          Before any team-specific tuning, put two controls in place. Together they cap
          both individual consumption and total metered spend, so you are protected from
          day one.
        </Text>
        <ol className={styles.stepList}>
          <li className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <div className={styles.stepBody}>
              <strong>Universal user-level budget (ULB).</strong> Applies to every
              Copilot-licensed user and is always a hard stop, in both the pool and
              metered phases. It is your primary defence against overages and the
              noisy-neighbour problem. Set it a little above the per-license credit value
              so pooling still works. A $0 budget blocks a user immediately.
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <div className={styles.stepBody}>
              <strong>Enterprise budget with “Stop usage” enabled.</strong> Caps total
              metered charges after the shared pool is exhausted. It is <em>not</em> a
              total-bill cap — your maximum bill is license fees <em>plus</em> the
              enterprise budget. Turn on “Stop usage when budget limit is reached” (it is
              off by default) so charges can&apos;t run past the cap.
            </div>
          </li>
        </ol>
      </section>

      {/* Two things to remember */}
      <div className={styles.calloutGrid}>
        <div className={`${styles.callout} ${styles.calloutInfo}`}>
          <ShieldCheckIcon size={16} />
          <div>
            <strong>User-level budgets always hard-stop.</strong> They cap a user&apos;s
            total credits across both the pool and metered usage, and no other budget can
            override or top them up. Most specific wins: individual → cost center → universal.
          </div>
        </div>
        <div className={`${styles.callout} ${styles.calloutWarn}`}>
          <StopIcon size={16} />
          <div>
            <strong>“Stop usage” is off by default.</strong> Cost center, organization, and
            enterprise budgets only block when it is enabled — otherwise charges keep
            accruing past the limit. Always turn it on when you create one of these budgets.
          </div>
        </div>
      </div>

      {/* Use cases */}
      <section>
        <Heading as="h2" className={styles.sectionHeading}>
          Common use cases
        </Heading>
        <Text as="p" className={styles.sectionLead}>
          Opinionated recipes for the most common goals. Each builds on the two controls
          above.
        </Text>
        <div className={styles.useCaseGrid}>
          {USE_CASES.map((uc) => (
            <div
              key={uc.title}
              className={`${styles.useCase} ${uc.featured ? styles.useCaseFeatured : ""}`}
            >
              <div className={styles.useCaseHead}>
                <span className={styles.useCaseIcon}>
                  <uc.icon size={18} />
                </span>
                <Heading as="h3" className={styles.useCaseTitle}>
                  {uc.title}
                </Heading>
                {uc.badge ? (
                  <Label variant="success" size="small">
                    {uc.badge}
                  </Label>
                ) : null}
              </div>
              <Text as="p" className={styles.useCaseSituation}>
                {uc.situation}
              </Text>
              <ul className={styles.useCaseSteps}>
                {uc.steps.map((s, i) => {
                  const g = GLYPH[s.glyph];
                  return (
                    <li key={i} className={styles.useCaseStep}>
                      <span className={styles.stepGlyph} title={g.label} aria-hidden="true">
                        <g.icon size={13} />
                      </span>
                      <span>{s.text}</span>
                    </li>
                  );
                })}
              </ul>
              {uc.note ? (
                <Text as="p" className={styles.useCaseNote}>
                  <InfoIcon size={12} /> {uc.note}
                </Text>
              ) : null}
              <div className={styles.useCaseFooter}>
                <span className={styles.chipLabel}>Uses</span>
                {uc.controls.map((c) => (
                  <span key={c} className={styles.chip}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Isolating a cost center: section header + card */}
      <section>
        <Heading as="h2" className={styles.sectionHeading}>
          Isolating a cost center&apos;s usage
        </Heading>
        <Text as="p" className={styles.sectionLead}>
          An <strong>included-usage control</strong> caps how much of the shared pool a
          cost center can draw before the metered phase begins — the key to true team
          isolation. It is set per cost center with the{" "}
          <code>ai_credit_pool_enabled</code> field, which is currently only available
          through the cost centers REST API — there is no UI for it yet.
        </Text>
        <div className={styles.card}>
        <div className={styles.poolTableWrap}>
          <table className={styles.poolTable}>
            <thead>
              <tr>
                <th>Setting</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>false</code> <span className={styles.muted}>(default)</span>
                </td>
                <td>No cap — the cost center draws freely from the shared enterprise pool.</td>
              </tr>
              <tr>
                <td>
                  <code>true</code>
                </td>
                <td>
                  Capped at the credits its own licenses fund. At the cap, block members or
                  let usage continue as paid overage.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Text as="p" className={styles.muted} style={{ fontSize: 13, marginTop: 12 }}>
          Set it with the{" "}
          <Link
            href="https://docs.github.com/en/enterprise-cloud@latest/rest/billing/cost-centers?apiVersion=2026-03-10"
            target="_blank"
            rel="noopener noreferrer"
          >
            cost centers REST API <LinkExternalIcon size={12} />
          </Link>
          {" "}— it isn&apos;t in the cost center settings UI yet. Pair it with a cost center
          budget to cap metered charges.
        </Text>
      </div>
      </section>

      {/* Sources */}
      <section>
        <Heading as="h2" className={styles.sectionHeading}>
          References &amp; further reading
        </Heading>
        <Text as="p" className={styles.sectionLead}>
          Authoritative GitHub documentation for the recommendations above.
        </Text>
        <ul className={styles.sourceList}>
          <li>
            <Link
              href="https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/billing/budgets-for-usage-based-billing"
              target="_blank"
              rel="noopener noreferrer"
            >
              Budgets for usage-based billing <LinkExternalIcon size={12} />
            </Link>
            <span className={styles.muted}> — how the budget controls work and interact.</span>
          </li>
          <li>
            <Link
              href="https://docs.github.com/en/enterprise-cloud@latest/copilot/tutorials/budgets/optimizing-your-budget-configuration"
              target="_blank"
              rel="noopener noreferrer"
            >
              Optimizing your budget configuration <LinkExternalIcon size={12} />
            </Link>
            <span className={styles.muted}> — scenarios and sizing advice.</span>
          </li>
          <li>
            <Link
              href="https://docs.github.com/en/enterprise-cloud@latest/copilot/tutorials/budgets/getting-started-with-budget-controls"
              target="_blank"
              rel="noopener noreferrer"
            >
              Getting started with budget controls <LinkExternalIcon size={12} />
            </Link>
            <span className={styles.muted}> — step-by-step setup.</span>
          </li>
          <li>
            <Link
              href="https://docs.github.com/en/enterprise-cloud@latest/rest/billing/cost-centers?apiVersion=2026-03-10"
              target="_blank"
              rel="noopener noreferrer"
            >
              Cost centers REST API <LinkExternalIcon size={12} />
            </Link>
            <span className={styles.muted}>
              {" "}— the <code>ai_credit_pool_enabled</code> field and endpoints.
            </span>
          </li>
        </ul>
        <div className={`${styles.callout} ${styles.calloutInfo}`} style={{ marginTop: 12 }}>
          <AlertIcon size={16} />
          <div>
            Figures here are illustrative. This is not an official GitHub product — always
            confirm behaviour in your enterprise settings and against your GitHub billing
            statements.
          </div>
        </div>
      </section>
    </div>
  );
}

export function BudgetGuidance() {
  return (
    <div className={styles.guidanceLayout}>
      <GuidanceMain />
      <aside className={styles.guidanceAside}>
        {/* Request evaluation flow */}
        <div className={`${styles.card} ${styles.flowCard}`}>
          <div className={styles.cardHeaderRow}>
            <div>
              <Heading as="h2" style={{ fontSize: 16 }}>
                How every Copilot request is evaluated
              </Heading>
              <Text className={styles.muted} style={{ fontSize: 14 }}>
                Budgets are checked in order: user-level budget, then the shared pool,
                then metered budgets.
              </Text>
            </div>
          </div>
          <RequestFlow />
          <div className={styles.flowLegend}>
            <span className={styles.legendDot} style={{ background: C.good }} /> Included or overage
            <span className={styles.legendDot} style={{ background: C.warn }} /> Uncapped charges
            <span className={styles.legendDot} style={{ background: C.bad }} /> Blocked
          </div>
          <Text as="p" className={styles.muted} style={{ fontSize: 12, lineHeight: 1.5 }}>
            Metered usage also requires the &ldquo;AI credit paid usage&rdquo; policy to be
            enabled. If it is off, requests are blocked once the shared pool is exhausted,
            whatever the budgets allow.
          </Text>
        </div>
      </aside>
    </div>
  );
}
