---
phase: 3
title: "Phase 3: Toolchain Catalog and Installers"
status: todo
priority: P1
effort: "10h"
dependencies: [2]
---

# Phase 3: Toolchain Catalog and Installers (`libs/toolchains`)

## Goal
Port all 13 components of `install-toolchains.sh` into a data-driven catalog. Each toolchain declares its **sub-options** and **2-3 common ecosystem add-ons**. Each installer is a function that turns the user's choices into Runner calls.

## Contract
```ts
type Option =
  | { key: string; kind: 'select'; label: string; choices: Choice[]; default: string }
  | { key: string; kind: 'multi';  label: string; choices: Choice[]; default: string[] }
  | { key: string; kind: 'confirm'; label: string; default: boolean };
// Add-ons are a 'multi' option with key 'addons'; recommended entries are pre-checked.

interface Toolchain {
  id: string; label: string; description: string;
  requires?: string[];                 // auto-added unless already present (see resolveSelection)
  isPresent?(ctx): Promise<boolean>;   // e.g. bun binary exists → skip auto-add
  options: Option[];
  install(ctx: InstallContext, choices: Record<string, string | string[] | boolean>): Promise<void>;
}
```
- `resolveSelection(ids, ctx)` ports the dependency rules: `bun-tools` needs `nvm-bun` unless bun exists; `jenv` needs `java` unless a JDK exists in `/usr/lib/jvm`. New rules: the `flutter` add-on `android-sdk` selects the `android` component, and the `java` add-on `jenv` selects `jenv`. Output is in catalog order, with no duplicates.
- `parseOpts(['java.jdk=17,21', 'go.addons=gopls'])` validates each value against the option's choices and gives clear errors for unknown keys or values. Options that aren't given use their defaults.

## Catalog (ids preserved from the bash script; defaults in **bold**)
| id | Sub-options | Suggested add-ons (2-3) |
|---|---|---|
| nvm-bun | Node: **LTS** / Current / previous LTS; install bun: **yes** | **pnpm** (corepack), yarn (corepack), **typescript + tsx** (global) |
| bun-tools | multi: nx, turbo, expo, @nestjs/cli, @angular/cli, opencode-ai, @openai/codex, cline, @kilocode/cli (**all**) | n/a, because the list itself is the choice |
| go | version: **latest** (go.dev) | **gopls**, **golangci-lint**, delve |
| rust | toolchain: **stable** / beta / nightly; components clippy, rustfmt, rust-analyzer (**all**) | **cargo-nextest**, cargo-watch, cargo-edit |
| python | uv: **yes**; pipx: **yes** | **ruff**, poetry, pre-commit (via `uv tool install`) |
| pyenv | Python to install via pyenv: none / **latest 3.x** / pick from `pyenv install --list` top 3 | pyenv-virtualenv plugin |
| java | JDK: 17 / **21** / 25 (multi, apt `openjdk-N-jdk`); default JDK: one of the selected | **Maven** (apt), **Gradle** (latest zip → `/opt/gradle`, profile.d), jenv |
| jenv | global version: one of the registered JDKs (**21** if present) | export plugin (**on**), maven plugin, gradle plugin |
| flutter | channel: **stable** / beta | Android SDK (→ `android`), web support (`flutter config --enable-web`), **fvm** |
| android | platforms: **latest** / latest + previous; build-tools: **latest** | emulator + system image, NDK, CMake (all via sdkmanager) |
| cpp | compilers: **gcc** + **clang** (multi); build systems: **cmake + ninja**, meson, make (multi) | **cppcheck**, conan (`uv tool`), vcpkg (`~/.vcpkg`) |
| docker | add target user to `docker` group: **yes** | **lazydocker**, dive, hadolint (latest GitHub release binaries) |
| claude | none | none |

Notes:
- Android licenses: keep the explicit confirmation (`-y` / `--yes` accepts). The installer never accepts silently.
- GitHub-release binaries (lazydocker, dive, hadolint, golangci-lint, Gradle zip) use one shared helper. The helper resolves the latest tag through the GitHub API with a pinned fallback version, mirroring the nvm handling. It checks the `sha256` when the project publishes checksums.
- Go add-ons are installed with `go install …@latest` as the user, running after Go itself. Rust add-ons use `cargo install --locked`.

## Files to Create
- `ubuntu/libs/toolchains/src/index.ts` (exports `catalog`, `resolveSelection`, `parseOpts`)
- `ubuntu/libs/toolchains/src/types.ts`, `selection.ts`, `options.ts`, `github-release.ts`
- `ubuntu/libs/toolchains/src/toolchains/<id>.ts`, one file per catalog id (13 files)
- `ubuntu/libs/toolchains/src/**/*.spec.ts`

## Tasks & Steps
- [ ] 1. Types, `parseOpts`, `resolveSelection` and their tests.
- [ ] 2. Port each component in bash-script order. Default choices must produce the same effective commands as today; java is the exception, since its default is now JDK 21 only, chosen by the user in the prompt. Record the parity check per component in the spec.
- [ ] 3. Add the sub-options and add-ons from the table.
- [ ] 4. `github-release.ts` with fallback and checksum verification. Unit-test it with a mocked `fetch`.
- [ ] 5. Catalog invariant test: unique ids; every `requires` target exists; every default is among its choices; every `select`/`multi` has ≥1 choice; `addons` has ≤3 entries.
- [ ] 6. Script-shape tests: for every toolchain, run `install` under `RecordingRunner` with defaults and with every choice enabled. Snapshot the scripts and check every script with `bash -n`.

## Verification
- `cd ubuntu && npx nx test toolchains` passes.
- `npx nx lint toolchains` is clean.

## Risks
- Apt package names differ across releases (e.g. `openjdk-25-jdk` on older Ubuntu). Keep the per-package fallback and the "JDK N not available" warning, and fail only when none of the selected JDKs got installed.
- Third-party release asset names change. A fallback version plus a clear error message keeps one add-on from failing the whole toolchain: each add-on failure becomes a warning, collected in the summary.
