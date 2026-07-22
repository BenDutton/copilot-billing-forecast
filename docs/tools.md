# Tools

Copilot Billing Forecast groups its tools into categories. Upload a GitHub
usage report CSV once, then switch between the tools below without your data ever
leaving your browser. The **Budget Setup Guide** is reference material and works even
before a report is loaded.

All figures are estimates. AI Credit (AIC) costs use **1 AIC = $0.01 USD**, and
monthly projections run to the end of the calendar month containing the report's
latest day, because GitHub AI Credit entitlements reset monthly. Always refer to your
GitHub billing statements as the source of truth.

## Compare to the previous month

Alongside the main report you can add a **previous month's** CSV (the "Add previous
month CSV" control next to the loaded report). When present, the comparable summary
stat cards in each tool gain a **"vs last month"** line showing the percentage change,
with the previous figure on hover. An increase in spend or usage is shown in red and a
decrease in green; plain counts stay neutral. Covered cards include:

- **Usage Forecast** — observed total, daily run rate, and projected month total.
  The chart also overlays the previous month's cumulative usage as a dashed line.
- **Team Insights** — users, team total, and average per user. The "Average usage by
  user group" and "Per-user insights & budget forecast" tables gain a **Last month**
  column showing each group's / user's previous total with the change.
- **Model Breakdown** — models and total. The breakdown table gains a **vs last month**
  column showing each model's increase or decrease.
- **Cost Center Rollup** — cost centers, total, and active users. The breakdown table
  gains a **vs last month** column showing each cost center's increase or decrease.
- **Spike Detection** — the baseline run rate.

Like the main report, the comparison CSV is parsed and held **in memory in your
browser only**; it is never persisted or sent anywhere. Clearing or replacing the main
report also clears the comparison. A previous-month report can also be preloaded with
the build (see the README's "Preloading a report" section), in which case it is locked
alongside the main report.

- [Usage Forecast](#usage-forecast) — _Forecasting_
- [Team Insights](#team-insights) — _Breakdowns_
- [Model Breakdown](#model-breakdown) — _Breakdowns_
- [Cost Center Rollup](#cost-center-rollup) — _Breakdowns_
- [Spike Detection](#spike-detection) — _Monitoring_
- [Budget Setup Guide](#budget-setup-guide) — _Guidance_

## Usage Forecast

Forecast total AI Credit consumption and track it against your entitlement.

**What it shows**

- Cumulative actual usage to date, with a projected trend over the remaining horizon.
- A shaded **95% prediction band** around the projection that widens the further out
  it goes.
- An optional **entitlement cap** line, the projected exhaustion date, and any
  projected **overage in USD**.
- A **trend indicator** (rising / falling / flat) and the fit's R² as a confidence cue.

**How to read it**

- Enter your entitlement to see when, and by how much, you are projected to exceed it.
- Use the **projected daily run rate** control to model a different rate from today
  onward. Set it as a percentage change relative to the fitted rate (the slider) or as
  an exact figure (the input) - the two stay in sync, so you only ever set one. When a
  scenario rate is active the projection becomes a flat line whose band shows expected
  day-to-day variability (rather than the trend's prediction interval), and a grey
  baseline line tracks the unadjusted trend for comparison.

**Key assumptions**

- The projection is an ordinary least squares linear regression fit to daily usage.
  The most recent day is excluded from the fit when enough earlier days remain, since
  reports are usually pulled mid-day and the partial total would drag the trend down.

### How the forecast range is calculated

The Usage Forecast fits an **ordinary least squares linear regression** to your daily
AI Credit usage and projects that trend forward over the horizon. The shaded band
around the projection is an approximate **95% prediction interval**, calculated as
follows:

- The fitted line gives the central `forecast` value for each day.
- The band half-width at a given day is `t · SE · √(1 + 1/n + (x − x̄)² / Sₓₓ)`, where
  `SE` is the residual standard error of the fit, `n` is the number of days used, and
  the square-root term is the standard prediction-interval leverage factor (the band
  widens the further you project from the observed data).
- `t` is an approximate 95% critical value that widens for small samples (≈4.3 for
  ≤2 days down to 1.96 for >30 days) to account for added uncertainty.
- Both bounds are floored at zero since daily usage can't be negative, and the
  cumulative projected total is reported as a range (`projectedLower` to
  `projectedUpper`) by summing each day's bounds.

A couple of adjustments keep the run rate realistic:

- The **most recent day is excluded from the regression** when at least three earlier
  days remain, because the report is typically pulled mid-day and its partial total
  would otherwise drag the trend down. It is still plotted as an actual.
- The **trend indicator** (rising / falling / flat) compares the slope's effect over
  the horizon against the noise level, so small fluctuations read as flat.

The implementation lives in [src/lib/forecast.ts](../src/lib/forecast.ts).

## Team Insights

Per-user metrics, models, and budget forecasts.

**What it shows**

- A per-user table with total AI Credits, active days, run rate, and a projected
  month-end total, with search, sorting, and pagination.
- A **spend distribution** across users and per-user month-end projections against an
  optional budget.
- **Usage cohorts** (power, heavy, typical, light, and near-zero users) with the
  average and median spend per user in each.

**How to read it**

- Set a budget to flag users projected to exceed it by month-end.
- Use the cohorts to see how concentrated spend is among your heaviest users.

**Key assumptions**

- Each user's run rate is their average AI Credits per active day, falling back to a
  simple mean when there are too few days to fit a regression.
- Cohorts rank active users by AIC gross cost; near-zero users have less than $1 of
  AIC cost in the report.

## Model Breakdown

AI Credit usage and trends broken down by model.

**What it shows**

- A stacked area chart of daily AI Credit usage per model over time.
- A per-model table with totals and trends, expandable for detail.

**How to read it**

- Identify which models drive the most spend and whether their usage is rising.

## Cost Center Rollup

Roll up AI Credit usage and budgets by cost center.

**What it shows**

- A stacked area chart of daily AI Credit usage per cost center.
- A per-cost-center table with each center's share of spend, user and model counts,
  run rate, and projected month-end total.

**How to read it**

- Compare cost centers by their share of total spend and month-end trajectory.

**Key assumptions**

- Rows without a cost center are grouped under `(no cost center)`; share is each
  center's portion of total AI Credits in the report.

## Spike Detection

Flag days with anomalous usage above the trend.

**What it shows**

- An actual usage line plotted against an expected line and an **expected range** band.
- **Spike markers** on days whose usage rises anomalously above the trend.
- A table of flagged days with the top contributing users and models for each.

**How to read it**

- Investigate flagged days to find the users or models behind an unexpected jump.

**Key assumptions**

- The expected range is derived from the usage trend and its variability; days above
  the band are flagged as spikes.

## Budget Setup Guide

Opinionated, read-only guidance for setting up GitHub Copilot budgets. Unlike the other
tools, it needs no uploaded report — it is reference material you can open at any time.

**What it shows**

- A "start here" priority: always set a **universal user-level budget** and an
  **enterprise budget** (with "Stop usage when budget limit is reached" enabled) first.
- A [React Flow](https://reactflow.dev) diagram of **how every Copilot request is
  evaluated** — user-level budget, then the shared AI-credit pool, then metered
  cost center / organization / enterprise budgets.
- **Common use-case recipes**, including preventing overages and the noisy-neighbour
  problem, and isolating each cost center's usage (with overages).
- UI-first steps for enabling an **AI credit pool** while creating or editing a cost
  center, choosing what happens at its automatically calculated limit, and separately
  capping metered charges with a cost center budget.

**How to read it**

- Start with the two "do this first" controls, then pick the use case that matches your
  enterprise structure.
- Follow the linked GitHub docs for authoritative, up-to-date detail.

**Key assumptions**

- Figures are illustrative. This is not an official GitHub product; always confirm
  behaviour in your enterprise settings and against your GitHub billing statements. The
  guidance follows GitHub's
  [Budgets for usage-based billing](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/billing/budgets-for-usage-based-billing)
  documentation.
