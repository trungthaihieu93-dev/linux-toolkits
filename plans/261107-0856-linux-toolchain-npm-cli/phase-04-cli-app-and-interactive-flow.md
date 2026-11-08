---
phase: 4
title: "Phase 4: CLI App and Interactive Flow"
status: todo
priority: P1
effort: "5h"
dependencies: [3]
---

# Phase 4: CLI App and Interactive Flow (`apps/linux-toolchain`)

## Goal
Build a commander + chalk CLI, runnable via `npx linux-toolchain` / `bunx linux-toolchain`, that keeps the bash script's flags. After the user picks multiple toolchains, it walks each selected toolchain's sub-options and suggested add-ons before installing anything.

## Command Surface
```
linux-toolchain [install] [ids...]   # default command; with no ids and a TTY → interactive
  --all                 select every toolchain
  --only <id,id>        same as the positional ids (kept for bash-script parity)
  --opt <key=value>     repeatable; e.g. --opt java.jdk=17,21 --opt java.addons=maven,gradle
  --defaults            accept defaults for every sub-option (non-interactive)
  --user <name>         target user (only when running as root)
  -y, --yes             skip confirmations (incl. Android SDK licenses)
  --dry-run             print the root/user scripts that would run; change nothing
linux-toolchain list [--json]          # ids, labels, options, add-ons
linux-toolchain --version | --help
```
Interactive prompts use `@inquirer/prompts` (`checkbox`, `select`, `confirm`). Commander has no prompt support, so this is the minimal addition needed for the requested selection flow. Chalk handles all colour.

## Flow
1. Preflight: Linux only. Refuse on other platforms with a clear message. No apt → warn, and apt-dependent toolchains fail as they do today.
2. Toolchain selection: a checkbox list of the catalog (label + description), unless ids, `--all` or `--only` were given.
3. `resolveSelection` adds dependencies and prints a chalk note for each one ("bun not found; adding nvm-bun").
4. Per-toolchain step, for each selected toolchain in order: show a header (`Java (2/4)`), prompt each option, then the add-ons checkbox with recommended entries pre-checked. Skipped when `--defaults`/`-y` is set or the stdin isn't a TTY; then `--opt` values or defaults apply. A missing TTY with no ids → error naming `--all` / `--only`, as today.
5. Review: a summary table of the toolchains and the choices made, then "Proceed?" (skipped with `-y`).
6. Execute sequentially. Each toolchain is isolated: a failure is recorded and the rest continue, as with the subshell in the bash script.
7. Summary: `ok` / `failed` / add-on warnings, and the "open a new shell / re-login for docker group" note. Exit code 1 if anything failed.

## Files to Create / Modify
- `ubuntu/apps/linux-toolchain/src/main.ts`: commander program wiring
- `ubuntu/apps/linux-toolchain/src/cli/options.ts`: argv → typed `RunConfig`
- `ubuntu/apps/linux-toolchain/src/cli/prompts.ts`: interactive selection + per-toolchain options, with the prompt functions injected for tests
- `ubuntu/apps/linux-toolchain/src/cli/execute.ts`: sequential runner + summary
- `ubuntu/apps/linux-toolchain/src/**/*.spec.ts`
- `ubuntu/apps/linux-toolchain/README.md`: usage, `npx`/`bunx` examples, the sudo model, migrating from the bash script
- `ubuntu/package.json`: add `commander`, `chalk`, `@inquirer/prompts` as devDependencies. They are bundled, and the published manifest keeps zero runtime deps.

## Tasks & Steps
- [ ] 1. Commander program, `RunConfig` parsing, and unit tests for flag combinations (`--all` + ids → error; `--only` ≡ positional; unknown id lists valid ids).
- [ ] 2. Prompt flow with injected prompt functions. Tests cover multi-selection (java + go + docker) producing the expected choices map, and recommended add-ons being pre-checked.
- [ ] 3. Execution + summary using `RecordingRunner` in tests: one failing toolchain doesn't stop the others, and the exit code is 1.
- [ ] 4. Dry-run end-to-end test that runs the built bundle: `node <dist>/apps/linux-toolchain/main.js --all --defaults -y --dry-run` exits 0 and prints a `[root]` and a `[user]` block.
- [ ] 5. Packaging check: `npm pack` inside the dist app folder, then `npx --yes ./linux-toolchain-*.tgz --help` and `bunx ./linux-toolchain-*.tgz --help` both print the help.

## Verification
- `cd ubuntu && npx nx run-many -t lint test build` exits 0.
- Manual smoke on this machine: `npx --yes <tarball> --dry-run` interactive, choosing Java → JDK 17 + 21, Maven, Gradle. The dry-run output shows the matching apt and Gradle steps.

## Risks
- `bunx` runs the `#!/usr/bin/env node` shebang with node when it exists, and with bun's node shim otherwise. The bundle must avoid Node-only APIs that bun lacks. CI runs `bunx` explicitly (step 5).
- Prompt rendering under `sudo npx` (euid 0) keeps the TTY. This is covered by the runner context tests, and the README documents that a plain `npx` is preferred.
