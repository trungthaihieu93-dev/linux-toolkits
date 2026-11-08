---
title: Plan linux-toolchain npm CLI
date: 2026-11-07
summary: "Six-phase plan to port install-toolchains.sh to an Nx-hosted npx/bunx CLI with sub-options, CI publish and agent skills"
---

# Plan linux-toolchain npm CLI

## What happened
Planned `linux-toolchain`, an npm CLI ported from `ubuntu/install-toolchains.sh`. The plan lives in `plans/261107-0856-linux-toolchain-npm-cli/` and has 6 phases, about 28h of work.

## Decision
- `ubuntu/` becomes the Nx integrated monorepo root: `apps/linux-toolchain`, `libs/core`, `libs/toolchains`.
- TypeScript port. The CLI runs as the normal user and calls `sudo` for each root step. Under `sudo npx`, user steps go through `runuser`. All side effects go through a `Runner`, which makes `--dry-run` and tests possible.
- A data-driven catalog keeps the 13 bash component ids. Each toolchain gets its own sub-options (e.g. Java: JDK 17/21/25, Maven, Gradle) and at most 3 suggested add-ons.
- commander + chalk + @inquirer/prompts, bundled with esbuild into one ESM file with zero runtime dependencies.
- CI runs lint, test, build, a pack test under npx and bunx, and a real smoke install of go and cpp in an `ubuntu:24.04` container. Pushing a `linux-toolchain@X.Y.Z` tag publishes with provenance using `NPM_TOKEN`.
- `ubuntu/AGENTS.md` is the canonical agent guide, and `ubuntu/CLAUDE.md` imports it with `@AGENTS.md`. Skills: `superpowers@claude-plugins-official`, Nx via `nx configure-ai-agents`, and a repo-authored shell-scripting skill.

## Next steps
- Re-check that the `NPM_TOKEN` secret exists. `gh secret list` failed locally.
- Confirm what `nx configure-ai-agents` generates.
- Implement with `/ak-cook plans/261107-0856-linux-toolchain-npm-cli/plan.md`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
