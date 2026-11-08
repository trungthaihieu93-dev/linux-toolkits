---
title: "Bun runtime for the CLI workspace + Astro Starlight docs site"
description: "Switch ubuntu/ from npm to bun.lock and the Bun runtime for development, and add a tech-themed Astro + Starlight docs site in website/ whose first section documents the Ubuntu toolchains, deployed to Cloudflare Pages."
status: pending
priority: P1
effort: 16h
branch: main
tags: [infra, docs, bun, astro, starlight, ci]
blockedBy: []
blocks: []
created: 2026-11-07
---

# Bun runtime + Starlight docs

## Overview
Two linked changes:
1. **Bun for development.** `ubuntu/` drops npm (`package-lock.json`) for `bun.lock`. Nx, vitest and eslint run on the Bun runtime (`bun --bun nx ...`), and `bun apps/linux-toolchain/src/main.ts` becomes the no-build dev loop. The published package does not change: it is still one Node ESM bundle for `npx`/`bunx` users, checked on Node 22.13 and 24, and published with `npm publish --provenance`.
2. **Docs site.** `website/` is a standalone Astro + Starlight project (bun, its own `bun.lock`). It has a tech theme derived from `ak-ui-ux-pro-max` and `ak-ui-styling`, and Ubuntu toolchains are its first section. The toolchain reference is generated from the CLI's `list --json` at build time, so it cannot drift from the catalog. GitHub Actions deploys it to Cloudflare Pages: production on `main`, a preview per PR.

## Intake Decisions
| Decision | Choice |
|---|---|
| Docs location | Root `website/`, a standalone bun project (not in the Nx workspace) |
| Bun depth | bun package manager + Bun runtime for Nx/vitest/eslint + `bun src/main.ts` dev loop; vitest stays |
| Deploy | Cloudflare Pages via `cloudflare/wrangler-action` |
| Reference content | Generated from `list --json`; guides hand-written |
| Scope mode | HOLD (no `--yagni`) |

## Evidence (probed 2026-11-07 in scratch copies)
- `bun install` (1.4.4) on `ubuntu/` writes a text `bun.lock` (lockfileVersion 2). `bunx nx run-many -t lint test build`: 7/7. `bunx nx run linux-toolchain:e2e`: pass. `bun --bun nx run-many -t test`: 3/3.
- `bun apps/linux-toolchain/src/main.ts list` runs the TS source directly and resolves the `@linux-toolchain/*` tsconfig paths.
- The only blocked lifecycle script is `@parcel/watcher` (a build-from-source fallback; the prebuilt binary is used). No `trustedDependencies` are needed.
- The Starlight template (astro 7.3.6, @astrojs/starlight 0.42.10) builds with `bun --bun astro build`. `@astrojs/starlight-tailwind` 5.0.0 needs `tailwindcss ^4` and installs cleanly. Astro 7 requires Node >=22.23.4 when run on Node.
- `list --json` returns 13 entries of `{id, label, description, requires, addonImplies, options[{key, kind, label, default, choices[{value,label,hint}]}]}`.
- `ak-ui-ux-pro-max` design system for "developer documentation CLI": style Dark Mode (OLED), typography JetBrains Mono + IBM Plex Sans, primary #2563EB / #3B82F6, CTA #F97316, "code dark + run green", avoid a light-mode default, WCAG contrast ≥4.5:1, visible focus, reduced motion respected.

## Phases
| # | Phase | Status | Depends on |
|---|-------|--------|------------|
| 1 | [Bun workspace migration](./phase-01-bun-workspace.md) | Pending | PR #8 merged |
| 2 | [Starlight site and tech theme](./phase-02-starlight-site-and-theme.md) | Pending | none (parallel with 1) |
| 3 | [Ubuntu toolchains content](./phase-03-ubuntu-toolchains-content.md) | Pending | 1, 2 |
| 4 | [Docs CI, Cloudflare deploy, repo docs](./phase-04-docs-ci-deploy-and-repo-docs.md) | Pending | 1, 2, 3 |

Phases 1 and 2 own disjoint files (`ubuntu/`, `.github/workflows/ci.yml`, `publish.yml` vs `website/`) and can run in parallel.

## Success Criteria
- [ ] `ubuntu/package-lock.json` is gone and `ubuntu/bun.lock` is committed. `cd ubuntu && bun install --frozen-lockfile && bun run lint && bun run test && bun run build` passes (scripts use `bun --bun nx`).
- [ ] `cd ubuntu && bun run dev -- list` runs the CLI from TS source.
- [ ] CI installs with bun. The checks, node-compat (22.13.0, 24), smoke and publish jobs stay green, and the published tarball is byte-for-byte the same kind of artifact (one `main.js`, zero runtime deps).
- [ ] `cd website && bun install --frozen-lockfile && bun run build` produces a static site with a splash home page and an Ubuntu section: overview, quick start, usage/flags, how it works, troubleshooting, and 13 generated toolchain pages plus a reference index.
- [ ] Theme: dark by default (when no stored preference), IBM Plex Sans body, JetBrains Mono code, tokens in one CSS layer, contrast ≥4.5:1 in both modes, visible focus, `prefers-reduced-motion` respected, no horizontal scroll at 375px.
- [ ] Internal links are validated at build time (`starlight-links-validator`).
- [ ] The `docs.yml` workflow builds on PRs and deploys previews (when the secrets are available), and deploys production on `main` to Cloudflare Pages. The production URL serves the site.
- [ ] Root `README.md`, `AGENTS.md`, `ubuntu/README.md`, the CLI README dev section and the agent MCP configs reflect bun and `website/`.

## Prerequisites (user)
- Merge PR #8 (agent config at root) first: phases 1 and 4 edit `AGENTS.md`, `.codex/config.toml` and `opencode.json` at the root.
- Cloudflare: create an API token with **Account → Cloudflare Pages → Edit** and set the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` via `gh secret set` (never pasted into chat).
- The Pages project name defaults to `linux-toolkits-docs` (URL `https://linux-toolkits-docs.pages.dev`). Override it before phase 4 if you want another name or a custom domain.

## Non-goals
- No change to the published CLI's runtime target (Node >=22.13) or to `npm publish --provenance`. `bun publish` is not used.
- No replacement of vitest with `bun test`.
- No docs for topics other than Ubuntu toolchains (no placeholder sections).
- No conversion of `website/` into an Nx project.

## Risks
- **Nx under the Bun runtime** is less proven than on Node. Mitigation: CI runs `bun --bun nx`, and the node-compat job still tests the bundle on Node. If a task misbehaves only under `--bun`, that target falls back to `bunx nx` (Node underneath), and the reason is recorded in AGENTS.md.
- **Prettier would reformat `bun.lock`** (JSONC). Add it to `.prettierignore`.
- **Fork PRs have no secrets**, so preview deploys are skipped for them; the build and link check still run.
- **Cloudflare Pages project creation:** [UNVERIFIED] whether `wrangler pages deploy` creates a missing project non-interactively. Phase 4 step 1 creates it explicitly with `wrangler pages project create`.
- **Docs build depends on `ubuntu/` deps** (`list --json` runs the TS source, so commander and chalk must be installed). The docs workflow installs both projects.

## Validation Log
### Session 1 (2026-11-07)
- Intake (5 questions): website/ at root; bun PM + Bun runtime; Cloudflare Pages; generated reference.
- Verified by probes: see Evidence.
- Unverified: Pages project auto-creation (phase 4 creates it explicitly); the Cloudflare secrets do not exist yet (`gh secret list` shows only NPM_TOKEN).

<!-- slug: bun-runtime-and-starlight-docs -->

### Verification Results
- Claims checked: 12 (Standard tier: fact checker + contract verifier)
- Verified: 11 | Failed: 1 (fixed) | Unverified: 1
- Fixed: the MCP command `bun --cwd ubuntu x nx` fails ("Script not found x"). Replaced with `bun run --cwd ubuntu nx mcp .`, which was probed: `nx_workspace_path` = `ubuntu/`.
- Corrected wording: setup-bun uses `bun-version-file`; `tsx` is unused (strings and globs only); a job-level `if:` cannot read `secrets` (moved to a step-level env guard); wrangler-action v4.1.3 outputs `deployment-url` and `pages-deployment-alias-url`; starlight-links-validator 0.27.0 peers astro >=7.2.10 and starlight >=0.42.0.
- Still unverified: whether `wrangler pages deploy` auto-creates a missing project (phase 4 step 1 creates it explicitly).

### Whole-Plan Consistency Sweep
- The MCP command, setup-bun input and secret guard wording are consistent across plan.md and phases 1 and 4. Phase dependencies (1 ∥ 2 → 3 → 4) match the Phases table. No contradictions remain.
