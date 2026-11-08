---
phase: 1
title: "Phase 1: Bun workspace migration"
status: pending
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Bun workspace migration

## Goal
Make bun (with `bun.lock`) the package manager and the Bun runtime the default for developing the CLI in `ubuntu/`, without changing the published Node bundle.

## Files to Create / Modify
- Modify: `ubuntu/package.json`: set `packageManager` to `bun@1.4.4`. Scripts: `lint`/`test`/`build`/`e2e` become `bun --bun nx run-many -t <target>`, add `dev` = `bun apps/linux-toolchain/src/main.ts`, and `format:check`/`format` = `bun --bun nx format:check|write`. Drop `tsx` from devDependencies: verified unused (it only appears inside installer script strings and vitest globs), and `bun` runs TS directly.
- Delete: `ubuntu/package-lock.json`.
- Create: `ubuntu/bun.lock` (via `bun install`).
- Modify: `ubuntu/.prettierignore`: replace `package-lock.json` with `bun.lock`.
- Modify: `.github/workflows/ci.yml`:
  - `checks` job: `oven-sh/setup-bun@v2` with `bun-version-file: ubuntu/package.json` (reads `packageManager`) and `actions/cache` on `~/.bun/install/cache` keyed on `hashFiles('ubuntu/bun.lock')`. Install with `bun install --frozen-lockfile`; Nx steps run as `bun --bun nx affected|run-many -t lint test build e2e`; `bun --bun nx format:check --all`.
  - Keep `actions/setup-node@v7` (Node 24) in `checks` for `npm pack` and the `npx` tarball test, but drop its `cache: npm`.
  - `node-compat`, `smoke`: unchanged (they test the packed bundle on Node).
- Modify: `.github/workflows/publish.yml`: no install step changes expected (it publishes the CI artifact). Check that it never references `package-lock.json` or `npm ci`.
- Modify: `.codex/config.toml` and `opencode.json`: change the nx-mcp command to `bun run --cwd ubuntu nx mcp .`. This was verified on 2026-11-07: the handshake returns `nx_workspace_path` = `ubuntu/`. (`bun --cwd ubuntu x nx` does not work: "Script not found x".)
- Modify: `AGENTS.md` Commands section, `CLAUDE.md` if it names npm, `ubuntu/README.md` Commands, `ubuntu/apps/linux-toolchain/README.md` (development section only; the user-facing `npx`/`bunx` usage is unchanged), root `README.md` Development section.

## Tasks & Steps
1. Confirm PR #8 is merged and rebase onto `main`.
2. In `ubuntu/`: `rm package-lock.json && rm -rf node_modules && bun install`, then commit `bun.lock`. Do not add `trustedDependencies` (`@parcel/watcher`'s blocked script is a source-build fallback).
3. Update `package.json` scripts and `packageManager`. Run `bun run lint`, `bun run test`, `bun run build`, `bun run e2e`. If a target fails only under `--bun`, switch that script to `bunx nx` and note why in AGENTS.md.
4. `bun run dev -- list` and `bun run dev -- --only go --defaults -y --dry-run`. These must print the same output as the built bundle (diff them).
5. Update `.prettierignore`, then `bun run format:check`.
6. Edit `ci.yml` as above; run `actionlint` (docker `rhysd/actionlint`) on both workflows.
7. Update the MCP command in `.codex/config.toml` and `opencode.json`, then re-run the MCP initialize + `nx_workspace_path` handshake from the repo root.
8. Update docs (files listed above). Search the repo: `rg -n 'npm ci|npm run|npx nx|package-lock' --glob '!website/**' --glob '!plans/**'` should return only intentional npm uses (`npm pack`, `npm publish`, user-facing `npx linux-toolchain`).

## Verification
- `cd ubuntu && bun install --frozen-lockfile && bun run lint && bun run test && bun run build && bun run e2e` passes; `npm` is not invoked.
- Diff of `bun run dev -- list --json` against `node <bundle>/main.js list --json` is empty.
- The CI PR run is green on checks, node-compat (22.13.0, 24) and smoke.
- The packed tarball still contains exactly `LICENSE`, `README.md`, `main.js` and `package.json`, and the manifest has no `dependencies`.

## Rollback
Revert the commit; `package-lock.json` comes back from git history.
