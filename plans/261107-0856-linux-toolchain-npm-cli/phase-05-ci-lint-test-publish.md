---
phase: 5
title: "Phase 5: CI Lint, Test, Publish"
status: todo
priority: P1
effort: "3h"
dependencies: [4]
---

# Phase 5: CI: Lint, Test, Publish

## Goal
Add GitHub Actions that lint and test every change under `ubuntu/` and publish `linux-toolchain` to npm with the existing `NPM_TOKEN` repo secret.

## Design
- Workflows live at the repo root (`.github/workflows/`), because GitHub only reads them there. Jobs use `defaults.run.working-directory: ubuntu`.
- **`ci.yml`** triggers on pull_request and on push to `main`, with `paths: ['ubuntu/**', '.github/workflows/**']`.
  - `checks` job (ubuntu-latest): checkout with `fetch-depth: 0`; `actions/setup-node` with Node 24 and npm cache keyed on `ubuntu/package-lock.json`; `npm ci`; `nrwl/nx-set-shas`; `npx nx affected -t lint test build`; `shellcheck install-toolchains.sh`. Then the pack test from phase 4 step 5, with `oven-sh/setup-bun` for the `bunx` check.
  - `smoke` job: inside an `ubuntu:24.04` container, create a non-root user and run the built CLI as root with `--user`: `--only go,cpp --defaults -y`. Then assert that `/usr/local/go/bin/go version` and `gcc --version` succeed. This exercises real apt, sudo-less root and `runuser` paths, using cheap components only.
- **`publish.yml`** triggers on push of tags matching `linux-toolchain@*`.
  - It reruns the `checks` steps (reusable via `workflow_call` from `ci.yml`, to avoid duplicating them).
  - Verify that the tag version equals `apps/linux-toolchain/package.json` version. Fail otherwise.
  - `npx nx build linux-toolchain`, then `npm publish --provenance --access public` from the dist app folder, with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and `permissions: { contents: read, id-token: write }`.
  - Skip with a notice when that version already exists on npm (`npm view linux-toolchain@<v> version`). This makes re-running a tag safe.
- Release procedure (documented in AGENTS.md): bump the version in `apps/linux-toolchain/package.json`, commit, then `git tag linux-toolchain@X.Y.Z && git push --tags`.

## Files to Create
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

## Tasks & Steps
- [ ] 1. Confirm that the secret exists without printing it: `gh secret list --repo trungthaihieu93-dev/linux-toolkits | grep -c '^NPM_TOKEN'` → 1. If it's missing, stop and ask the user. On 2026-11-07 `gh secret list` failed from the planning machine, likely because of gh auth for the `github.com-personal` SSH alias account. Run `gh auth status` first.
- [ ] 2. Write `ci.yml` with `checks` (also exposed as `workflow_call`) and `smoke`.
- [ ] 3. Write `publish.yml`.
- [ ] 4. Run `actionlint` locally if installed (or via `docker run rhysd/actionlint`).
- [ ] 5. Push a branch and open a PR, after the user approves. CI must be green.
- [ ] 6. The first publish (`linux-toolchain@0.1.0` tag) happens only after the user's explicit go-ahead, because it is outward-facing and the npm name gets claimed.

## Verification
- The PR shows green `checks` and `smoke`.
- After tagging: `npm view linux-toolchain version` = 0.1.0, and `npx --yes linux-toolchain@0.1.0 list` works on a clean machine.

## Security
- The token reaches the job only through `secrets.NPM_TOKEN`, is never echoed, and the publish job has no PR trigger, so forks can't reach it.
- Provenance ties the npm package to this repo and workflow.
