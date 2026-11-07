# AGENTS.md

Guide for AI agents (and humans) working in this repository. It is the single
source of truth; `CLAUDE.md` imports it. User-facing CLI behaviour lives in
`ubuntu/apps/linux-toolchain/README.md`; do not restate it here.

## Purpose

`linux-toolchain` is an interactive installer for developer toolchains on
Debian/Ubuntu, published to npm and run with `npx linux-toolchain` or
`bunx linux-toolchain`. It is a TypeScript port of
`ubuntu/install-toolchains.sh`: the same toolchain ids and rc/profile markers,
plus per-toolchain sub-options, add-ons and `--dry-run`.

## Repository layout

| Path                                               | Owns                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `ubuntu/`                                          | Nx workspace (bun). All code, tests and Nx commands live here        |
| `website/`                                         | Docs site (Astro + Starlight, bun); see "Docs site"                  |
| `.github/workflows/`                               | `ci.yml` (checks and npm release) and `docs.yml` (Cloudflare Pages)  |
| `AGENTS.md`, `CLAUDE.md`                           | Agent guide (this file) and the Claude Code import of it             |
| `.claude/`, `.agents/`, `.codex/`, `opencode.json` | Agent configuration and skills; see "Skills and agent configuration" |

Inside `ubuntu/`. Code paths in the rest of this guide are relative to
`ubuntu/`; agent-config paths (starting with `.claude`, `.agents`, `.codex`
or `opencode.json`) are relative to the repository root.

| Path                    | Owns                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `apps/linux-toolchain`  | CLI (commander + `@inquirer/prompts` + chalk), bundled by esbuild into one ESM file |
| `libs/core`             | `@linux-toolchain/core`: Runner, context resolution, logger, shell snippet builders |
| `libs/toolchains`       | `@linux-toolchain/toolchains`: catalog, option parsing, selection, installers       |
| `install-toolchains.sh` | Legacy bash installer, kept as the reference. Do not delete it                      |

The libs are bundled into the CLI and never published on their own.

## Commands

Run from `ubuntu/` (Nx 24.0.5, bun 1.4.4). Nx commands do not work from the
repository root, which is not an Nx workspace:

```sh
bun install                               # CI: bun install --frozen-lockfile
bun run lint && bun run test && bun run build
bun --bun nx test toolchains              # one project
bun run e2e                               # builds, then runs the bundle (apps/linux-toolchain/e2e)
bun run format:check                      # prettier; fix with bun run format
bun run dev -- --all --defaults -y --dry-run
```

Bun is the package manager (`bun.lock`; `npm` is not used for development)
and the runtime: the scripts run `bun --bun nx ...`, so Nx, vitest and eslint
run on Bun, and `bun run dev` runs `apps/linux-toolchain/src/main.ts` directly
from TypeScript. The published bundle still targets Node 22.13 or newer. The
e2e target runs the bundle with the current runtime (Bun under `bun run e2e`);
the CI `node-compat` job runs it on Node 22.13 and 24. Do not add
`trustedDependencies`: the one blocked install script (`@parcel/watcher`) is a
build-from-source fallback that is not needed.

The last line prints every root/user script a full install would run and
changes nothing. The publishable package is the build output folder
`dist/apps/linux-toolchain/` (`main.js`, `package.json`, `README.md`, `LICENSE`).

## Architecture

- **Runner** (`libs/core/src/runner.ts`): every side effect is a bash script
  passed to `asRoot(script, label)` or `asUser(script, label)`.
  `ProcessRunner` runs them for real: as a normal user, root steps go through
  `sudo` (one prompt, refreshed in the background); as root, user steps go
  through `runuser` with `HOME`/`USER`/`LOGNAME` set. `rootScript`/`userScript`
  add the same wrapping as the bash script (`DEBIAN_FRONTEND`, `USER_ENV`,
  `set -e`). `DryRunRunner` prints `[root]`/`[user]` blocks; `RecordingRunner`
  records calls for tests and can fail chosen labels.
- **Context** (`libs/core/src/context.ts`): `resolveContext` decides
  `isRoot`, target user and home (`--user`, `SUDO_USER`, `getent passwd`).
- **Snippet builders** (`libs/core/src/shell.ts`): `shQuote`, `aptInstall`,
  `addRcBlock`, `writeProfile` and the `devtools-profile-hook` marker. They are
  pure and return bash text. Markers are byte-identical to
  `install-toolchains.sh` so machines it configured are recognised.
- **Catalog** (`libs/toolchains/src/catalog.ts`): the ordered `Toolchain` list
  (install order = bash script order). The `Toolchain`, `Option` and
  `InstallContext` contracts are in `libs/toolchains/src/types.ts`.
- **Options and selection**: `libs/toolchains/src/options.ts` parses
  `--opt id.key=value` and reads choices (`choiceString`, `choiceList`,
  `choiceBool`); `libs/toolchains/src/selection.ts` (`resolveSelection`) adds
  `requires` and `addonImplies` dependencies.
- **InstallContext** (`libs/toolchains/src/install-context.ts`): runner,
  logger, fs probes, injectable `fetch`, and `warn()`, which collects warnings
  for the end-of-run summary.
- **Shared helpers** (`libs/toolchains/src/toolchains/shared.ts`): `tryAddon`
  turns an add-on failure into a warning instead of failing the toolchain;
  `requireApt` fails early without apt-get. GitHub release downloads with
  sha256 verification: `libs/toolchains/src/github-release.ts`.
- **CLI flow** (`apps/linux-toolchain/src/cli/`): `program.ts` (commander),
  `options.ts` (flags to run config), `prompts.ts`, `install.ts` and
  `execute.ts` (review, base packages, per-toolchain isolation, summary).

## Adding a toolchain

1. Create `libs/toolchains/src/toolchains/<id>.ts` exporting a `Toolchain`;
   use an existing installer such as `go.ts` as the pattern.
2. Register it in `libs/toolchains/src/catalog.ts` at its install position.
3. Add `<id>.spec.ts` next to it: drive `install` with a `RecordingRunner`
   and `createInstallContext`, assert the recorded calls, and check that every
   script parses with `bash -n` (see `go.spec.ts`).
4. Keep add-ons to at most 3 choices in a `multi` option with key `addons`
   (`libs/toolchains/src/catalog.spec.ts` enforces it), and wrap each add-on in
   `tryAddon`.
5. Add the toolchain row to the table in `apps/linux-toolchain/README.md`.
6. Run `bun run lint && bun run test && bun run build` and the dry-run invocation above.

## Invariants

- All side effects go through `Runner`. Installers never spawn processes or
  write files directly; read-only probes go through `InstallContext`.
- Every interpolated value in a script goes through `shQuote`.
- Markers (`# >>> name >>>`, `/etc/profile.d/devtools-<name>.sh`,
  `# devtools-profile-hook`) stay byte-identical to `install-toolchains.sh`.
- At most 3 add-ons per toolchain.
- Zero runtime dependencies in the published manifest
  (`apps/linux-toolchain/package.json`). Third-party packages are
  `devDependencies` of the workspace and are inlined by esbuild.
- Tests never run the CLI against the real system: use `RecordingRunner`, or
  the built bundle with `--dry-run`. Never run the CLI without `--dry-run` on a
  development machine.
- Snapshot files (`__snapshots__/`) change only intentionally. Review the diff
  of a snapshot update as carefully as the code change that caused it.

## Release

Releasing is a version bump: change `version` in
`apps/linux-toolchain/package.json` in a pull request and merge it. Merging is
the outward-facing step, so bump only with the maintainer's go-ahead.

On every push to `main` (and on a manual run of CI from `main`), the `release`
job in `.github/workflows/ci.yml` runs after `checks`, `node-compat` and
`smoke` pass. If that version is not on npm yet, it publishes the tarball those
jobs tested (`npm publish --provenance`), waits until npm serves it, and pushes
the `linux-toolchain@X.Y.Z` tag. A version that is already on npm is skipped,
so re-running is safe.

Authentication: npm tries trusted publishing (OIDC; repository
`trungthaihieu93-dev/linux-toolkits`, workflow `ci.yml`) first and falls back
to the `NPM_TOKEN` secret, which must be a granular token with write access
and "Bypass 2FA". After a trusted publisher is configured on npmjs.com, delete
`NPM_TOKEN`.

## Docs site (`website/`)

A standalone Astro + Starlight project (bun, its own `bun.lock`), not part of
the Nx workspace. Production: https://linux-toolkits-docs.pages.dev.

```sh
cd website
bun install                               # also run bun install in ubuntu/
bun run dev                               # http://localhost:4321
bun test && bun run check && bun run build
```

- **Generated reference.** `scripts/gen-toolchains.ts` runs the CLI from
  source (`list --json`) and writes `src/content/docs/ubuntu/toolchains/<id>.md`
  and `src/data/toolchains.json`; rendering lives in the pure
  `scripts/render-toolchains.ts` (tested by `bun test`). Both outputs are
  gitignored and regenerated by `predev`/`prebuild`/`precheck`. Never edit
  them: change the catalog in `ubuntu/libs/toolchains` instead. Guides under
  `src/content/docs/ubuntu/*.mdx` are hand-written and must match
  `--help` and `list --json`; install examples carry `--dry-run`.
- **Theme.** Colour and font tokens live only in `src/styles/theme.css`
  (with its contrast table); components use tokens, never raw hex. Text
  contrast stays at or above 4.5:1 in both modes, focus stays visible, and
  motion respects `prefers-reduced-motion`. `ThemeProvider.astro` makes dark
  the default until the visitor picks a theme; `TerminalHero.astro` is the
  Starlight `Hero` override. Tailwind v4 (via `@astrojs/starlight-tailwind`)
  is for custom components only.
- **Scripts.** They run `bun --bun astro ...`. Do not add a script named
  `astro` (`bun --bun astro` would call it recursively). TypeScript stays on
  `^6` while `@astrojs/check` does not support 7.
- **Links.** `starlight-links-validator` fails the build on broken internal
  links.
- **Deploy.** `.github/workflows/docs.yml` builds on pull requests and `main`
  (paths `website/**`, the CLI app, `ubuntu/libs/**`, `ubuntu/bun.lock`,
  `ubuntu/package.json`, `ubuntu/tsconfig.base.json`), checks out the full
  history for "Last updated" dates,
  deploys a preview per pull request with one updated comment, and deploys
  production from `main` to the Cloudflare Pages project `linux-toolkits-docs`
  with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. Fork
  pull requests build without deploying.

## Skills and agent configuration

All agent configuration lives at the repository root, so Claude Code, Codex
and opencode pick it up whether they start in the root or in `ubuntu/` (each
one reads `AGENTS.md`/`CLAUDE.md` from the parent folders too). Start the agent
in the repository root so the project config folders below are found.

| Skill / config  | Where                                                                                                                             | Use it for                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| superpowers     | Claude Code: plugin `superpowers@claude-plugins-official`; opencode: `plugin` in `opencode.json`; Codex: `/plugins` → superpowers | Process discipline: brainstorming, planning, TDD, debugging, review              |
| Nx              | Claude Code: plugin `nx@nx-claude-plugins`; Codex/opencode: skills in `.agents/skills/` and the `nx-mcp` server                   | Exploring projects and targets, running tasks, generators, Nx docs               |
| shell-scripting | `.claude/skills/shell-scripting` (`.agents/skills/shell-scripting` is a symlink)                                                  | Editing `.sh` files, rc/profile files, `libs/core/src/shell.ts`, install scripts |

Per agent:

- **Claude Code**: `.claude/settings.json` registers the `nrwl/nx-ai-agents-config`
  marketplace, enables `nx@nx-claude-plugins` and
  `superpowers@claude-plugins-official`, and allows the Nx daemon paths in the
  sandbox. The plugin's Nx MCP server starts in the session folder, so its
  workspace tools only see the workspace when the session starts in `ubuntu/`;
  `nx_docs` works from anywhere. Skills: `.claude/skills/`.
- **Codex**: `.codex/config.toml` starts `nx-mcp` with
  `bun run --cwd ubuntu nx mcp .` (workspace path `ubuntu/`) and registers the CI monitor subagent
  (`.codex/agents/ci-monitor-subagent.toml`). Skills: `.agents/skills/`.
- **opencode**: `opencode.json` loads the superpowers plugin and starts
  `nx-mcp` with the same `bun run --cwd ubuntu nx mcp .` command. opencode reads `AGENTS.md` and discovers skills in
  both `.claude/skills/` and `.agents/skills/`.

The Nx files were generated by `bunx nx configure-ai-agents --agents claude codex`
in `ubuntu/` and then moved to the root. Re-running that command writes into
`ubuntu/` again: move any updated files up, merge its guidelines block into the
block below, and delete the copies it creates under `ubuntu/` (`AGENTS.md`,
`CLAUDE.md`, `.claude/`, `.agents/`, `.codex/`). Leave the block's start/end
comments in place.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
