# Contributing

Thanks for your interest in improving the Copilot Billing Forecast toolbox. Please
read the privacy constraint and development guidelines below before making changes.

## ⚠️ PRIVACY - READ THIS FIRST

**Uploaded usage data MUST NEVER leave the client.** All CSV parsing, analysis,
and forecasting happens entirely in the browser. There is **no server-side
processing, no upload to any API, and no persistence** of the user's data
beyond the current browser session (in-memory / optional local storage only).

When adding new tools or features, **never** send the parsed report data to a
server, API route, telemetry endpoint, or third party. Treat this as a hard
architectural constraint.

## Tech stack

- **Next.js** (App Router, TypeScript) - the application framework.
- **GitHub Primer React** (`@primer/react`) - UI component library for an authentic
  GitHub look (Header, PageLayout, NavList, SegmentedControl, FormControl, etc.).
  Theming comes from `@primer/primitives` and icons from `@primer/octicons-react`.
- **CSV parsing** - client-side (PapaParse) only.
- **Charts** - Recharts for the forecast visualizations.
- **Toasts** - Sonner for client-side notifications.

## Architecture / conventions

- All report-data handling lives in client components (`"use client"`). No API routes
  touch user data.
- Parsing/forecasting logic lives in `src/lib/` so it is testable and reusable across tools.
- UI is built with Primer React; `ThemeProvider` + `BaseStyles` are set up in
  `src/components/providers.tsx` and the primitives light theme is imported in the
  root layout.
- Each tool is a route/view registered in a single sidebar config so adding a tool is
  a one-place change.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000 and load a usage report CSV.

### Preloading a report (optional)

Drop a usage report CSV at `public/preloaded-report.csv` to ship it with the
build. On load, `ReportProvider` (`src/components/report-provider.tsx`) fetches
that static asset, parses it client-side, and locks the report so it cannot be
uploaded, replaced, or cleared. If the file is absent the fetch 404s and the app
falls back to the normal upload flow. This keeps the client-only constraint
intact: the CSV is served as a static asset and parsed entirely in the browser.

## Development guidelines

- Keep the **client-only data** constraint inviolable.
- Add UI elements with **Primer React** (`@primer/react`) components; prefer them over
  hand-rolled markup. Use `@primer/octicons-react` for icons.
- Register new tools in the sidebar config and add a corresponding view.
- Keep parsing tolerant of all three report variants and legacy columns.
