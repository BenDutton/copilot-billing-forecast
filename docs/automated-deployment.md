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
  with access to the billing usage reports API (see
  [Creating the `BILLING_TOKEN`](#creating-the-billing_token) below).
- An `ENTERPRISE` repository variable set to your enterprise slug (the value in
  `github.com/enterprises/<slug>`, not an organization name).
- GitHub Pages enabled for the repository (Settings → Pages → "GitHub Actions").

## Creating the `BILLING_TOKEN`

The usage reports API requires a token whose owner is an **enterprise admin or
billing manager**. A **classic personal access token (PAT)** is the most
reliable choice, because it does not depend on the enterprise opting in to
fine-grained PATs:

1. Go to **Settings → Developer settings → Personal access tokens → Tokens
   (classic) → Generate new token (classic)**
   ([github.com/settings/tokens/new](https://github.com/settings/tokens/new)).
2. Set a name and an expiration.
3. Select the **`manage_billing:enterprise`** scope.
4. Click **Generate token** and copy the value immediately.
5. If your enterprise enforces SAML SSO, authorize the token for the
   enterprise/organization after creating it.

> A fine-grained PAT with the **Enterprise administration** permission can also
> work, but only when an enterprise owner has enabled fine-grained PATs with the
> enterprise as the resource owner. If the enterprise does not appear as a
> resource owner when you create the token, use the classic PAT above instead.

Finally, add the token as a secret in the caller repository: **Settings →
Secrets and variables → Actions → New repository secret**, named `BILLING_TOKEN`.

## Calling the reusable workflow

Add a caller workflow to your own repository. The example below fetches the
report on a daily schedule and on demand, then redeploys to GitHub Pages:

```yaml
# .github/workflows/scheduled-report.yml
#
# Example caller for the reusable `auto-report-pages.yml` workflow. Set the
# `ENTERPRISE` repository variable and the `BILLING_TOKEN` secret first.
name: Scheduled usage report deploy

on:
  schedule:
    - cron: "0 6 * * *" # Every day at 06:00 UTC
  workflow_dispatch: # Allow manual runs

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    uses: BenDutton/copilot-billing-forecast/.github/workflows/auto-report-pages.yml@main
    with:
      enterprise: ${{ vars.ENTERPRISE }}
    secrets:
      billing_token: ${{ secrets.BILLING_TOKEN }}
```

## Inputs

The workflow always exports the `ai_credit` (AI usage) report type. By default it
fetches the current calendar month (UTC); pass `month` as `MM-YY` (e.g. `06-26`)
to target a specific month — the first and last day are derived automatically.

### Inputs (`with`)

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `enterprise` | string | Yes | — | Enterprise slug to fetch the usage report for (the value in `github.com/enterprises/<slug>`, not an organization name). |
| `month` | string | No | `""` (current month, UTC) | Report month as `MM-YY` (e.g. `06-26`). The first and last day of the month are derived automatically. |
| `include_previous_period` | boolean | No | `false` | Also fetch the previous calendar month as the comparison report (`public/preloaded-report-previous.csv`). |

### Secrets

| Name | Required | Description |
| --- | --- | --- |
| `billing_token` | Yes | Token for an enterprise admin or billing manager with access to the billing usage reports API. See [Creating the `BILLING_TOKEN`](#creating-the-billing_token). |

### Permissions

The caller workflow must grant these permissions so the reusable workflow can
publish to GitHub Pages:

| Permission | Level | Why |
| --- | --- | --- |
| `contents` | `read` | Check out the app source to build it. |
| `pages` | `write` | Publish the built site to GitHub Pages. |
| `id-token` | `write` | OIDC token used by the Pages deployment. |

See the [reusable workflow](../.github/workflows/auto-report-pages.yml) for the
authoritative definition.

