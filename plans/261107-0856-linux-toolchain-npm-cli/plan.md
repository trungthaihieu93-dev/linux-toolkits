---
title: "linux-toolchain npm CLI (Nx workspace under ubuntu/)"
description: "Port install-toolchains.sh to a commander+chalk CLI published as `linux-toolchain`, runnable via npx/bunx, with per-toolchain sub-options and add-ons, CI and agent docs."
status: pending
priority: P1
effort: 28h
branch: main
tags: [feature, infra, cli, nx]
blockedBy: []
blocks: []
created: 2026-11-07
---

# linux-toolchain npm CLI

## Overview
`ubuntu/` becomes an Nx integrated monorepo. `apps/linux-toolchain` is a TypeScript port of `ubuntu/install-toolchains.sh`, bundled into one zero-dependency ESM file and published to npm as `linux-toolchain` (`npx linux-toolchain` / `bunx linux-toolchain`). After the user selects toolchains, the CLI asks each one's sub-options (e.g. Java → JDK 17/21/25, Maven, Gradle) and offers 2-3 common ecosystem add-ons. CI lints, tests, smoke-installs and publishes with the existing `NPM_TOKEN`. `ubuntu/AGENTS.md` and `ubuntu/CLAUDE.md` ship with superpowers, Nx and shell skills.

## Intake Decisions
| Decision | Choice |
|---|---|
| Nx root and agent docs | `ubuntu/` |
| Execution model | TS port; run as normal user, `sudo` per root step (also works under `sudo npx` via `runuser`) |
| npm name | `linux-toolchain` (unclaimed as of 2026-11-07) |
| Skills | Plugin refs (superpowers, Nx `configure-ai-agents`) + repo-authored shell skill |
| Scope mode | HOLD (no `--yagni`) |

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | [Nx Workspace Scaffold](./phase-01-start.md) | Pending |
| 2 | [Core System Lib](./phase-02-core-system-lib.md) | Pending |
| 3 | [Toolchain Catalog and Installers](./phase-03-toolchain-catalog-and-installers.md) | Pending |
| 4 | [CLI App and Interactive Flow](./phase-04-cli-app-and-interactive-flow.md) | Pending |
| 5 | [CI Lint, Test, Publish](./phase-05-ci-lint-test-publish.md) | Pending |
| 6 | [Agent Docs and Built-in Skills](./phase-06-agent-docs-and-skills.md) | Pending |

Order: 1 → 2 → 3 → 4 → 5. Phase 6 can draft after 1 but finalizes last.

## Success Criteria
- [ ] `cd ubuntu && npx nx run-many -t lint test build` is green locally and in CI.
- [ ] All 13 bash-script components are available, keeping their ids and the `--all/--only/--user/-y/--list` behaviour (`list` is a subcommand).
- [ ] Multi-select → per-toolchain sub-options → add-ons (≤3, recommended pre-checked) → review → install. Non-interactive via `--defaults` / `--opt`.
- [ ] `--dry-run` shows every root/user script without changing the system.
- [ ] CI smoke job installs `go,cpp` for real in an `ubuntu:24.04` container.
- [ ] Tag `linux-toolchain@X.Y.Z` publishes with provenance. `npx`/`bunx linux-toolchain@X.Y.Z --help` works.
- [ ] `ubuntu/AGENTS.md` and `ubuntu/CLAUDE.md` (`@AGENTS.md`), with the superpowers plugin, Nx agent config and shell skill wired.

## Non-goals
- No non-Debian package managers (dnf/pacman). Behaviour matches the bash script, which needs apt.
- No deletion of `install-toolchains.sh`; it stays as the reference.

## Risks
- Nx generator/flag drift: read live `--help` before each generator (phase 1).
- Third-party release asset churn for add-ons: fallback versions, and add-on failures become warnings (phase 3).
- The first npm publish is outward-facing: it needs explicit user approval (phase 5).

## Validation Log
### Session 1 (2026-11-07)
- Intake interview (4 questions): Nx root `ubuntu/`; TS port with per-step sudo; npm name `linux-toolchain`; plugin refs + local shell skill.
- Verified: npm name unclaimed (`npm view` 404); superpowers is published as `superpowers@claude-plugins-official` (local plugin catalog); `ak plan validate` passes.
- Unverified: `NPM_TOKEN` presence (`gh secret list` failed locally, re-check in phase 5 step 1); `nx configure-ai-agents` output (phase 6).
- Consistency sweep: phase 6 marketplace wording updated to the official plugin id. No other contradictions found.

<!-- slug: linux-toolchain-npm-cli -->
