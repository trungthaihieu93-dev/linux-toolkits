---
title: Plan bun runtime and Starlight docs
date: 2026-11-07
summary: "Planned the switch of ubuntu/ to bun.lock and the Bun runtime, plus an Astro Starlight docs site in website/ deployed to Cloudflare Pages."
---

# Plan bun runtime and Starlight docs

## What happened
Planned two changes in plans/261107-1538-bun-runtime-and-starlight-docs: bun as the package manager and runtime for developing the CLI, and a tech-themed Astro + Starlight docs site whose first section covers the Ubuntu toolchains.

## Decisions
- Docs live in a standalone root website/ (bun, its own bun.lock), not in the Nx workspace.
- bun package manager + Bun runtime (`bun --bun nx`) for Nx, vitest and eslint; vitest stays. The published bundle stays Node >=22.13 and is published with npm provenance.
- The toolchain reference is generated from `list --json`, run from TS source by bun.
- Deploy to Cloudflare Pages via wrangler-action v4.
- Theme from ak-ui-ux-pro-max: dark first, IBM Plex Sans + JetBrains Mono, blue primary, green run accent.

## Evidence
Scratch probes: bun install wrote bun.lock; Nx ran 7/7 tasks plus e2e under bun; `bun --bun nx test` passed; the Starlight template built with `bun --bun astro build`. `bun --cwd ubuntu x nx` fails, while `bun run --cwd ubuntu nx mcp .` works.

## Next steps
Merge PR #8, set the Cloudflare secrets, then run /ak-cook on the plan. npm publish of 0.1.0 is still blocked on a 2FA-bypass token.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
