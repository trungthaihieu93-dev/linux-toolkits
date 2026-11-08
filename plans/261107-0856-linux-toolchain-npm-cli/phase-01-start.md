---
phase: 1
title: "Phase 1: Nx Workspace Scaffold"
status: todo
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Nx Workspace Scaffold

## Goal
Turn `ubuntu/` into an Nx integrated monorepo (`apps/`, `libs/`) holding an empty but buildable, lintable and testable `apps/linux-toolchain` Node CLI. Leave the existing `ubuntu/install-toolchains.sh` in place, unchanged.

## Decisions (from intake)
- The Nx root is `ubuntu/`. Every Nx command runs with `cwd=ubuntu/`.
- Package manager: npm (`package-lock.json`). The published artifact must also run under `bunx`.
- Bundler: `@nx/esbuild`, producing a single ESM file (`format: esm`, `platform: node`, `bundle: true`, `thirdParty: true`). Libs and the runtime deps (commander, chalk, @inquirer/prompts) are inlined, so `npx linux-toolchain` downloads one small package with no dependency tree.
- Tests: Vitest (the `@nx/vitest` plugin if the installed Nx ships it, else `@nx/vite`). Lint: the Nx flat ESLint config.

## Files to Create / Modify
- Create: `ubuntu/package.json`, `ubuntu/package-lock.json`, `ubuntu/nx.json`, `ubuntu/tsconfig.base.json`, `ubuntu/eslint.config.mjs`, `ubuntu/.gitignore`, `ubuntu/.prettierrc`
- Create: `ubuntu/apps/linux-toolchain/{project.json,package.json,README.md,tsconfig*.json,eslint.config.mjs,vite.config.ts,src/main.ts}`
- Create: `ubuntu/libs/core/` and `ubuntu/libs/toolchains/` as `@nx/js` libraries with `bundler: none` (consumed through the app bundle, never published on their own)
- Keep unchanged: `ubuntu/install-toolchains.sh`

## Tasks & Steps
- [ ] 1. Read `npx create-nx-workspace@latest --help` (preset names change between Nx majors). Scaffold in a scratch directory, because the generator refuses a non-empty target, then copy the result (minus `.git`) into `ubuntu/`. Example: `npx create-nx-workspace@latest ubuntu --preset=apps --pm=npm --nxCloud=skip --interactive=false`.
- [ ] 2. `npx nx add @nx/node`, `@nx/js`, `@nx/esbuild`, `@nx/eslint` and the Vitest plugin.
- [ ] 3. `npx nx g @nx/node:application apps/linux-toolchain --bundler=esbuild --framework=none --unitTestRunner=vitest --e2eTestRunner=none` (check flags with `--help` first).
- [ ] 4. `npx nx g @nx/js:library libs/core --importPath=@linux-toolchain/core --bundler=none --unitTestRunner=vitest`, and the same for `libs/toolchains` → `@linux-toolchain/toolchains`.
- [ ] 5. Configure the app build target: ESM, bundled, third-party inlined, banner `#!/usr/bin/env node`, output to the workspace dist folder `<dist>/apps/linux-toolchain/main.js`, and copy `apps/linux-toolchain/package.json` and `README.md` as assets.
- [ ] 6. Author `apps/linux-toolchain/package.json` as the published manifest: `"name": "linux-toolchain"`, `"version": "0.1.0"`, `"type": "module"`, `"bin": {"linux-toolchain": "main.js"}`, `"files": ["main.js", "README.md"]`, `"engines": {"node": ">=20"}`, `"os": ["linux"]`, `"repository"` = `trungthaihieu93-dev/linux-toolkits` with `"directory": "ubuntu/apps/linux-toolchain"`, `"publishConfig": {"access": "public"}`, and no `dependencies`.
- [ ] 7. Root scripts in `ubuntu/package.json`: `lint`, `test`, `build`, each `nx run-many -t <target>`.

## Verification
- `cd ubuntu && npx nx run-many -t lint test build` exits 0.
- The built `main.js` starts with the node shebang and `node <dist>/apps/linux-toolchain/main.js` exits 0.
- `git diff --stat ubuntu/install-toolchains.sh` is empty.

## Risks
- Generator flags drift between Nx majors. Mitigation: read live `--help` before each generator, and record the Nx version in AGENTS.md (phase 6).
- Vitest and esbuild both resolve the `@linux-toolchain/*` TS path aliases. Verify that both work before phase 2 starts.
