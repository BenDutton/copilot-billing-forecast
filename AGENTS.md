<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Contributing guidelines

Before making any changes, read [CONTRIBUTING.md](CONTRIBUTING.md). It contains the
project's tech stack, architecture and conventions, local setup, and development
guidelines - including the **hard client-only data privacy constraint** (uploaded
usage data must never leave the browser). Treat that constraint as inviolable.

# Keeping docs in sync

- Adding, renaming, or removing a tool: update both [README.md](README.md) and
  [docs/tools.md](docs/tools.md).
- Changing captured analytics: update [docs/analytics.md](docs/analytics.md).
- Changing setup, conventions, or the privacy constraint: update
  [CONTRIBUTING.md](CONTRIBUTING.md).
