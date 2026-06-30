# Automated deployment from the billing API

The reusable workflow
[.github/workflows/auto-report-pages.yml](../.github/workflows/auto-report-pages.yml)
fetches an enterprise usage report directly from the
[billing usage reports REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage-reports),
writes it to `public/preloaded-report.csv` (and optionally the previous calendar
month to `public/preloaded-report-previous.csv`), then builds and deploys the app
to GitHub Pages with the report already loaded and locked.

> ⚠️ Unlike the in-browser flow, this bakes real billing data into a static site
> under `public/`. The report becomes downloadable by anyone who can reach the
> Pages URL, so only use this with a **private/Enterprise Pages site or an
> internal, access-restricted repository**.

## Prerequisites

- A `BILLING_TOKEN` secret belonging to an enterprise admin or billing manager
  with access to the billing usage reports API.
- An `ENTERPRISE` repository variable set to your enterprise slug.
- GitHub Pages enabled for the repository (Settings → Pages → "GitHub Actions").

## Calling the reusable workflow

Add a caller workflow to your own repository. The example below fetches the
report on a daily schedule and on demand, then redeploys to GitHub Pages:

```yaml
# .github/workflows/scheduled-report.yml
#
# Example caller for the reusable `auto-report-pages.yml` workflow.
#
# It fetches the enterprise usage report from the billing API and redeploys the
# app to GitHub Pages on a schedule (and on demand). Set the `ENTERPRISE`
# repository variable and the `BILLING_TOKEN` secret (an enterprise admin or
# billing manager token) before enabling it.
name: Scheduled usage report deploy

on:
  # Refresh every morning at 06:00 UTC. Adjust or remove as needed.
  schedule:
    - cron: "0 6 * * *"
  # Allow manual runs, overriding the month and comparison toggle if desired.
  workflow_dispatch:
    inputs:
      month:
        description: "Report month as MM-YY (e.g. 06-26). Defaults to the current month."
        type: string
        default: ""
      include_previous_period:
        description: "Also preload the previous calendar month for comparison."
        type: boolean
        default: true

jobs:
  deploy:
    uses: BenDutton/copilot-billing-forecast/.github/workflows/auto-report-pages.yml@main
    with:
      enterprise: ${{ vars.ENTERPRISE }}
      month: ${{ inputs.month || '' }}
      include_previous_period: ${{ inputs.include_previous_period == true || github.event_name == 'schedule' }}
    secrets:
      billing_token: ${{ secrets.BILLING_TOKEN }}
```

## Inputs

The workflow always exports the `detailed` report type. By default it fetches
the current calendar month (UTC); pass `month` as `MM-YY` (e.g. `06-26`) to
target a specific month — the first and last day are derived automatically. See
the [reusable workflow](../.github/workflows/auto-report-pages.yml) for the full
list of inputs.
