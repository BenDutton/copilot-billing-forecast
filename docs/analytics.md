# Analytics

This app uses [PostHog](https://posthog.com/) for lightweight, privacy-preserving
product analytics. Analytics are **only enabled when the deployment is configured**
with `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`; otherwise no
analytics are collected at all.

Your uploaded usage data never leaves your browser. All CSV parsing, analysis, and
forecasting happen entirely client-side. Analytics events **never** include:

- the contents of your usage report (costs, quantities, models, etc.);
- usernames, organizations, repositories, or cost centers;
- the uploaded file's name or any personally identifiable information.

Only the aggregate, non-sensitive metadata listed below is captured.

## Events captured

| Event | When | Properties |
| --- | --- | --- |
| `csv_uploaded` | A usage report CSV is successfully parsed and loaded | `report_type` (`summarized` \| `detailed` \| `ai` \| `unknown`), `row_count` (number of rows in the report) |
| `tool_viewed` | A tool is opened from the sidebar (or via the logo reset) | `tool_id` (`usage-forecast` \| `team-insights` \| `model-breakdown` \| `spike-detection` \| `cost-center-rollup`) |
| `resource_clicked` | A curated Resources link in the sidebar is opened | `resource_label` (the link's title), `resource_category` (`News` \| `Courses & guides` \| `Videos`) |
| `github_link_clicked` | An outbound link to the project's GitHub repository is opened | `link_location` (`sidebar-source` \| `sidebar-build` \| `footer-source` \| `footer-issue`) |

Beyond this event, only anonymous pageviews (the app uses in-app state for navigation,
so URLs contain no report data) and basic device/browser information are recorded.

**Autocapture is disabled.** Because your usage report is rendered on screen (usernames,
costs, models, cost centers, filename), PostHog's automatic click/text capture is turned
off so that no on-screen data can be recorded. Session recording is also **disabled**.

## Disabling analytics

If you self-host or run the app locally without the PostHog environment variables set,
no analytics are initialized or sent. End users can also block analytics using their
browser's standard privacy controls or extensions.
