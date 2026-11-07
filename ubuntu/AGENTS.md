# AGENTS.md

Guide for AI agents (and humans) working in this Nx workspace. It is the single
source of truth; `CLAUDE.md` imports it. User-facing CLI behaviour lives in
`apps/linux-toolchain/README.md`; do not restate it here.

## Purpose

`linux-toolchain` is an interactive installer for developer toolchains on
Debian/Ubuntu, published to npm and run with `npx linux-toolchain` or
`bunx linux-toolchain`. It is a TypeScript port of `install-toolchains.sh`: the
same toolchain ids and rc/profile markers, plus per-toolchain sub-options,
add-ons and `--dry-run`.

## Layout

| Path                    | Owns                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `apps/linux-toolchain`  | CLI (commander + `@inquirer/prompts` + chalk), bundled by esbuild into one ESM file |
| `libs/core`             | `@linux-toolchain/core`: Runner, context resolution, logger, shell snippet builders |
| `libs/toolchains`       | `@linux-toolchain/toolchains`: catalog, option parsing, selection, installers       |
| `install-toolchains.sh` | Legacy bash installer, kept as the reference. Do not delete it                      |

The libs are bundled into the CLI and never published on their own.

## Commands

Run from `ubuntu/` (Nx 24.0.5, npm):

```sh
npm ci
npx nx run-many -t lint test build
npx nx test toolchains                    # one project
npx nx run linux-toolchain:e2e            # builds, then runs the bundle (apps/linux-toolchain/e2e)
npx nx format:check                       # prettier; fix with npx nx format:write
node dist/apps/linux-toolchain/main.js --all --defaults -y --dry-run
```

The last line prints every root/user script a full install would run and
changes nothing. The publishable package is the build output folder
`dist/apps/linux-toolchain/` (`main.js`, `package.json`, `README.md`).

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
6. Run `npx nx run-many -t lint test build` and the dry-run invocation above.

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

1. Bump `version` in `apps/linux-toolchain/package.json` and commit.
2. `git tag linux-toolchain@X.Y.Z && git push --tags`.

The publish workflow (`.github/workflows/publish.yml`, repository root) runs on
`linux-toolchain@*` tags, checks the tag against the package version, builds,
and publishes with provenance using the `NPM_TOKEN` secret. CI for pushes and
pull requests is `.github/workflows/ci.yml`. Publishing is outward-facing: tag
only with the maintainer's go-ahead.

## Skills and agent configuration

| Skill / config  | Where                                                                                         | Use it for                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| superpowers     | Claude Code plugin `superpowers@claude-plugins-official`; others: github.com/obra/superpowers | Process discipline: brainstorming, planning, TDD, debugging, review              |
| Nx              | Generated by `npx nx configure-ai-agents --agents claude codex`                               | Exploring projects and targets, running tasks, generators, Nx docs               |
| shell-scripting | `.claude/skills/shell-scripting` (`.agents/skills/shell-scripting` is a symlink)              | Editing `.sh` files, rc/profile files, `libs/core/src/shell.ts`, install scripts |

What `configure-ai-agents` set up (re-run it to update; `--check` reports drift):

- Claude Code: the `nx@nx-claude-plugins` plugin (marketplace
  `nrwl/nx-ai-agents-config`, providing the Nx MCP server, skills and agents)
  and the sandbox entries in `.claude/settings.json`.
- Codex and other AGENTS.md agents: Nx skills in `.agents/skills/`, the
  `nx-mcp` server (`npx nx mcp`) and a CI monitor subagent in `.codex/`.
- The Nx guidelines block below. Leave its start/end comments in place.
  The tool also writes this block into `CLAUDE.md`; it is kept only here
  (`CLAUDE.md` imports this file), so `--check` reports `CLAUDE.md` as out of
  date and a re-run re-adds the block there. Delete it from `CLAUDE.md` after
  re-running.

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
