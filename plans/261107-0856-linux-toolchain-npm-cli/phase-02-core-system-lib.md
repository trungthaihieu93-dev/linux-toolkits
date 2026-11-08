---
phase: 2
title: "Phase 2: Core System Lib"
status: todo
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Core System Lib (`libs/core`)

## Goal
Port the bash helpers (`log/warn/err`, `apt_install`, `user_sh`, `confirm`, `add_rc_block`, `write_profile`, target-user resolution) to typed TypeScript. Every side effect goes through one `Runner`, so dry-run mode and tests see exactly the shell that would run.

## Architecture
- `Runner` interface: `asRoot(script, label)` and `asUser(script, label)`. Each resolves on exit 0 and rejects with `StepError` (label, exit code) otherwise. Output is inherited stdio.
- `resolveContext(opts)` picks how commands run (decided at intake: the CLI runs as the normal user and elevates per step):
  - **Non-root euid (normal `npx` / `bunx`).** The target user is the current user. `asUser` = `bash -lc "<USER_ENV> set -e; <script>"`. `asRoot` = `sudo bash -c "set -e; <script>"`. Run `sudo -v` once before the first root step, then refresh it every 60s on an unref'd timer.
  - **euid 0 (user ran `sudo npx …`).** The target is `--user`, else `SUDO_USER`, else the CLI fails with the bash script's message. `asRoot` = `bash -c`. `asUser` = `runuser -u <user> -- env HOME=… USER=… LOGNAME=… bash -lc …`, which is today's `user_sh`.
  - `--user` without root is an error ("--user needs root").
  - The home directory comes from `getent passwd`, not from `$HOME`.
- `DryRunRunner` prints labelled `[root]`/`[user]` scripts and executes nothing. `RecordingRunner` is a test helper that collects calls.
- Pure snippet builders that return shell text:
  - `aptInstall(pkgs)` keeps the bulk-then-per-package fallback.
  - `addRcBlock(name, body, skipRegex?)` writes a marked, idempotent block to `~/.bashrc` and `~/.zshrc`.
  - `writeProfile(name, body)` writes `/etc/profile.d/devtools-<name>.sh` and adds the `# devtools-profile-hook` to `/etc/bash.bashrc` and `/etc/zsh/zshrc`.

  Keep the marker text byte-identical to the bash script, so machines already set up by it are recognised and nothing is duplicated.
- `shQuote(s)` for every interpolated value.
- `logger` on chalk, with the same `==>`, `[warn]` and `[error]` styling. `NO_COLOR` works through chalk.
- `system.ts`: `isLinux`, `hasApt`, `hasCommand`, `osRelease()` (parses `/etc/os-release`), `arch()` (x86_64→amd64, aarch64→arm64, otherwise unsupported).

## Files to Create
- `ubuntu/libs/core/src/index.ts`
- `ubuntu/libs/core/src/runner.ts`, `context.ts`, `shell.ts`, `logger.ts`, `system.ts`
- `ubuntu/libs/core/src/*.spec.ts`

## Tasks & Steps
- [ ] 1. `shQuote` and the snippet builders, with exact-text unit tests (port expected strings from `install-toolchains.sh` lines 63-115).
- [ ] 2. `resolveContext` with injectable `getuid`, `env` and `getent`. Unit-test four cases: plain user, sudo+SUDO_USER, sudo+--user, root with no user (error).
- [ ] 3. `ProcessRunner` (spawns `bash` / `sudo` / `runuser`), `DryRunRunner`, `RecordingRunner`.
- [ ] 4. A test that pipes each builder's output through `bash -n` (skipped if bash is absent).

## Verification
- `cd ubuntu && npx nx test core` passes, with ≥90% line coverage on `shell.ts` and `context.ts`.
- `npx nx lint core` is clean.

## Security
- No interpolation without `shQuote`. Catalog values are fixed, but `--user` and `--opt` values are user input.
- Sudo prompts only through the inherited TTY. The CLI never reads or stores the password.
