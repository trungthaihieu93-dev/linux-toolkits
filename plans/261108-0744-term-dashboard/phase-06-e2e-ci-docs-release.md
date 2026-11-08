---
phase: 6
title: "E2E, CI, docs and release wiring"
status: pending
priority: P2
effort: "3h"
dependencies: [5]
---

# Phase 6: E2E, CI, docs and release wiring

## Goal
Prove the built bundle end to end, run it in CI on Node 22.13 and 24, and document it. Publishing stays off: the package keeps `"private": true` and the release job is not changed.

## Files to create / modify
- Create `ubuntu/apps/term-dashboard/e2e/td.e2e.ts` and `vitest.e2e.config.mts`; add an `e2e` target (dependsOn `build`) like `linux-toolchain`. The test starts `node dist/apps/term-dashboard/main.js --no-open --port 0` with a temp `HOME`/`XDG_CONFIG_HOME`, `GSETTINGS_BACKEND=keyfile` and `DISPLAY`/`WAYLAND_DISPLAY` unset, parses the printed URL, then checks: health; 401 without token; 403 with a foreign `Host`; `index.html` and a hashed JS asset served; SSE receives `started`/`exited` for a shell save; zsh/bash Config save writes only the managed block and creates a backup; PTY WS echoes `echo td-ok`; SIGTERM and SIGHUP each leave no `script` or shell processes; a second `td` start finds the instance file and exits 0. Ghostty and gsettings cases skip when the binaries or schemas are missing.
- Modify `.github/workflows/ci.yml`: `checks` already runs `nx affected/run-many -t lint test build e2e`, so the new projects are covered; install `zsh` on the runner (`sudo apt-get install -y zsh`) so the zsh syntax specs run; extend `node-compat` to run `node dist/apps/term-dashboard/main.js --version` and the e2e health check on Node 22.13 and 24; extend `smoke` (which runs as root) to `npm pack` the td package and run `npx --yes ./linux-term-dashboard-*.tgz --version` and `--help` only; e2e covers the server path as a normal user.
- Do not modify the `release` job. It publishes the CI-built `linux-toolchain` tarball, and a new package's first version is never on npm, so wiring td in would publish on merge. Record the follow-up in the README's maintainer notes: remove `private`, add a second tarball to the release job, publish once, then configure trusted publishing for the new package.
- Complete `ubuntu/apps/term-dashboard/README.md`: what td does, safety model (loopback, token, allowlist, backups, checks), install (`npx linux-term-dashboard` / `bunx linux-term-dashboard`, then `td`), flags, local development (`bun run dev:td`, `bun run link:td`, `bun run unlink:td`), sandboxed testing env vars, restore from backups.
- Modify `AGENTS.md`: repository-layout rows for the three new projects, commands (`dev:td`, `link:td`, `unlink:td`, `nx test term-config`), architecture bullets (CommandRunner + ActivityBus, FileStore write pipeline, PTY via `script`), invariants (all td side effects through `CommandRunner`/`FileStore`; argv only, never shell strings; file ids not paths; loopback + token; managed-block markers fixed; tests use a temp HOME and `GSETTINGS_BACKEND=keyfile` and never touch the real machine; zero runtime deps), and a note in the release section that td is private and not released yet.
- Modify the root `README.md` and `ubuntu/README.md` if they list the workspace apps.

## Tasks & steps
1. Write and pass the e2e suite locally under `bun run e2e` (Bun) and `node`.
2. CI edits; run `actionlint` if available and push to a branch to see the workflow pass.
3. Docs edits; check every command in the README against `td --help` and `package.json` scripts.
4. Final gates: `bun run lint && bun run test && bun run build && bun run e2e && bun run format:check`.

## Verification
- All final gates pass locally and in CI on the PR.
- `npm pack --dry-run` in `dist/apps/term-dashboard` lists only `main.js`, `web/**`, `package.json`, `README.md` and `LICENSE`.
- `git diff main -- .github/workflows/ci.yml` shows no change to the `release` job, and `jq .private dist/apps/term-dashboard/package.json` prints `true`.

## Release note
Publishing happens only when a version bump PR is merged to `main`, with the maintainer's go-ahead. This plan does not wire td into it.

## Rollback
Revert the CI, docs and e2e files; the app keeps building.
