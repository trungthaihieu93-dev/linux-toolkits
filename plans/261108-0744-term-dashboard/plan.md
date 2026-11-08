---
title: "term-dashboard (td): local web dashboard for terminal and shell configs"
description: "Add an Nx CLI app under ubuntu/ that ships one `td` binary: a Hono backend on 127.0.0.1 serving a Vite/React tech dashboard that manages Ghostty, Ptyxis/GNOME Terminal and bash/zsh configs, streams every command it runs, and embeds a real PTY terminal."
status: in-progress
priority: P2
effort: 36h
branch: main
tags: [feature, frontend, backend, cli, nx, hono, react]
blockedBy: []
blocks: []
created: 2026-11-08
---

# term-dashboard (`td`)

## Overview
`td` is a second CLI app in the `ubuntu/` Nx workspace. Running `td` starts a Hono server on `127.0.0.1`, prints a tokenised URL and opens the browser. The React dashboard is served by the same process. The backend is the only component that reads or writes config files and runs commands. Every command it runs streams live to an activity panel, and an embedded xterm.js terminal talks to a real PTY. It ships as an npm package (`linux-term-dashboard`, bin `td`) built the same way as `linux-toolchain`: one Node ESM `main.js` with zero runtime dependencies, plus the built web UI as static files in the same package.

## Intake decisions
| Decision | Choice | Source |
|---|---|---|
| Streaming | Both: activity stream of every backend command, plus an interactive PTY terminal | user |
| Binary | npm package, Node ESM bundle (Node ≥22.13 or Bun), bin `td` | user |
| PTY under Node | util-linux `script -qfec` (no native module); resize via `stty -F <child pty>` | probe |
| Native terminals | Ptyxis always; GNOME Terminal when installed | user |
| Shell config mode | Form writes only inside `# >>> term-dashboard >>>` block; whole file editable in Monaco mode | user |
| Package name | `linux-term-dashboard` (`td` and `term-dashboard` are taken on npm); `"private": true` until the first publish is approved | probe, user confirmed |
| oh-my-zsh | A second managed block placed right above `source $ZSH/oh-my-zsh.sh` holds theme and plugins | red-team |
| gsettings access | `gsettings` only (never the `dconf` CLI); metadata from schema XML, values via `list-recursively` | red-team, probe |
| Session auth | Single-use 60 s launch code in the URL, swapped for a session token; instance file in `$XDG_RUNTIME_DIR` for port reuse | red-team |
| Web assets | Static files in `web/` next to `main.js`, served by `td`; only `td` lands on PATH | planner |
| Forms | Generated from live schemas: `gsettings range/describe` and `ghostty +show-config --default --docs` | probe |
| Scope mode | HOLD (no `--yagni`) | rule |

## Evidence (probed 2026-11-08 on this machine)
- Ubuntu 26.04.1, Bun 1.4.4, Node 26.13. `ptyxis` 50.1 and snap `ghostty` 1.4.0 are installed. `gnome-terminal` is not installed.
- Ptyxis schemas: `org.gnome.Ptyxis` (27 keys), relocatable `org.gnome.Ptyxis.Profile` at `/org/gnome/Ptyxis/Profiles/<uuid>/` (22 keys), `org.gnome.Ptyxis.Shortcuts`. `gsettings range` returns `enum` lists, `range d 0.0 1.0` and `type a(ss)`/`type (uu)`; `gsettings describe` returns the summary text.
- Ghostty: `+show-config --default --docs` prints 629 key lines (211 distinct keys; `palette`, `keybind` and `command-palette-entry` repeat), each with `#` doc comments and a default; `+list-themes --plain` prints 819 themes; `+list-fonts`, `+validate-config` and `+show-config` (effective config) exist. Both `~/.config/ghostty/config` and `config.ghostty` exist; `theme` set in `config` appears in the effective config, so both files are loaded.
- `script -qfec` gives a real tty under Node. `stty -F /dev/pts/N cols 140 rows 40` on the child's tty delivered SIGWINCH; `stty size` changed from `30 100` to `40 140`.
- `bun link` in a package folder puts its bin in `~/.bun/bin` (on PATH); `bun unlink` removes it.
- Current versions: hono 4.13.17, @hono/node-server 2.1.6, @hono/node-ws 1.3.1, react 19.3.1, vite 8.3.6 (already in the workspace), @vitejs/plugin-react 6.2.1, monaco-editor 0.57.0, @monaco-editor/react 4.7.0, @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, tailwindcss 4.3.5, radix-ui 1.8.1, lucide-react 1.70.0, diff 9.0.0.
- ak-ui-ux-pro-max design system ("developer tool dashboard terminal configuration monitoring"): Dark Mode (OLED), JetBrains Mono, primary #2563EB/#3B82F6, CTA #F97316, "code dark + run green", avoid a light-mode default, visible focus, reduced motion, breakpoints 375/768/1024/1440.

## Architecture
```text
td (main.js, Node ESM)                         browser (web/, React 19)
 ├─ commander: td [--port] [--no-open]          ├─ Overview / Ghostty / Ptyxis / GNOME Terminal
 ├─ Hono app on 127.0.0.1                       ├─ Shells: bash, zsh  (Config ⇄ Monaco)
 │   ├─ guard: Host + Origin + code → token     ├─ Terminal (xterm.js)  ── WS /ws/pty
 │   ├─ /api/*  REST (JSON)                      └─ Activity panel       ── SSE /api/activity
 │   ├─ /api/activity  SSE  ◄── ActivityBus ◄── CommandRunner (execFile argv, no shell strings)
 │   ├─ /ws/pty   WebSocket ◄── PtySession (script -qfec, stty -F resize)
 │   └─ static web/ (SPA fallback)
 ├─ services: FileStore (allowlist, backup, atomic write, bash -n / zsh -n, diff)
 │            GSettingsService (Ptyxis, GNOME Terminal; gsettings JSON backup)
 │            GhosttyService (files + ghostty CLI)  ShellService (managed block)
 └─ settings: ~/.config/term-dashboard/settings.json (theme, port, terminal shell)
@linux-toolchain/term-config (pure lib): ghostty parse/serialize + docs schema, GVariant text codec,
 gsettings range parser, rc managed-block codec, shell form model, API contract types
```

## Projects
| Path (under `ubuntu/`) | Kind | Owns |
|---|---|---|
| `apps/term-dashboard` | Node app, `@nx/esbuild` | CLI, Hono server, services, PTY, e2e |
| `apps/term-dashboard-web` | Vite + React app | Dashboard UI, theme, Monaco, xterm |
| `libs/term-config` | lib `@linux-toolchain/term-config` | Pure parsers/serializers and API types (no I/O) |

## Phases
| # | Phase | Status | Depends on |
|---|-------|--------|------------|
| 1 | [Workspace scaffold, CLI, server shell and link](./phase-01-scaffold-cli-server-link.md) | Completed | none |
| 2 | [term-config lib: parsers, codecs, API contract](./phase-02-term-config-lib.md) | Completed | 1 |
| 3 | [Backend services, activity stream and PTY](./phase-03-backend-services-activity-pty.md) | Completed | 2 |
| 4 | [Web shell, design system and terminal](./phase-04-web-shell-design-terminal.md) | Completed (live terminal and settings round-trip checks move to phase 5) | 1, 2 (steps 4-5 need 3) |
| 5 | [Config pages: Ghostty, Ptyxis/GNOME, shells](./phase-05-config-pages.md) | Pending | 3, 4 |
| 6 | [E2E, CI, docs and release wiring](./phase-06-e2e-ci-docs-release.md) | Pending | 5 |

Phase 4 owns only `apps/term-dashboard-web/` and can run in parallel with phases 2 and 3 after phase 1 lands. The API types it needs are fixed at the start of phase 2.

## Success criteria
- [ ] `cd ubuntu && bun run lint && bun run test && bun run build && bun run e2e` pass. `dist/apps/term-dashboard/` holds `main.js`, `web/`, `package.json`, `README.md` and `LICENSE`, and the manifest has zero `dependencies`.
- [ ] `bun run link:td` makes `td` resolve to `~/.bun/bin/td`; `td --help` and `td --version` work on Node 22.13+ and Bun; `bun run unlink:td` removes it.
- [ ] `td` listens on 127.0.0.1 only, never puts its session token in a URL or argv, and rejects requests without the token, with a foreign `Host` or with a foreign WebSocket `Origin`. A second `td` opens the running instance (verified through the 0600 instance file) instead of starting another server.
- [ ] Ghostty page: every key from `ghostty +show-config --default --docs` is editable (repeatable keys as lists, theme and font pickers). Saves are validated with `ghostty +validate-config` before replacing the file, and comments and key order are preserved.
- [ ] Ptyxis page: global settings, shortcuts and each profile (create, duplicate, rename, delete with confirmation) are generated from the installed schemas. GNOME Terminal appears with the same features only when its schema is installed. A gsettings JSON backup is taken before the first write of each run, and restoring it also removes profiles created afterwards. The `dconf` CLI is never used.
- [ ] Shell pages for bash and zsh: Config mode edits aliases, exports, PATH entries, history options and oh-my-zsh theme/plugins (in a second block right above `source $ZSH/oh-my-zsh.sh`, so they take effect). Monaco mode edits the whole file. Both show a diff before saving, run `bash -n`/`zsh -n` on the candidate, back the file up, and write atomically.
- [ ] The activity panel streams argv, stdout/stderr chunks, exit code and duration of every backend command live. The Terminal page runs an interactive login shell over a PTY that resizes with the window and is killed, including background jobs, when the tab closes or `td` exits by any signal.
- [ ] Theme: dark by default, light toggle persisted in `settings.json`, tokens in one CSS file, text contrast ≥4.5:1 in both modes, visible focus, reduced motion respected, no horizontal scroll at 375px.
- [ ] CI runs lint/test/build/e2e for the new projects and node-compat runs `td --version` on Node 22.13 and 24. The release job is unchanged and the package stays `private`.

## Non-goals
- No remote access: no `--host`, no TLS, no auth beyond the per-run token on loopback.
- No Bun-compiled executable and no native PTY module (`node-pty`).
- No management of other terminals (Kitty, Alacritty, WezTerm, Konsole) or other shells (fish).
- No default-terminal selection (`xdg-terminal-exec`) and no creating or editing Ptyxis palette files (the profile's `palette` key is editable).
- No live reload of a running Ghostty via signals (the UI shows Ghostty's reload shortcut instead). Ptyxis/GNOME Terminal apply gsettings changes live by themselves.
- No docs-site (`website/`) pages for td in this plan.
- No npm publish in this plan. td stays `private`; enabling release is a separate maintainer-approved change.

## Risks
- **Writing real dotfiles and dconf.** Mitigations: path allowlist (no arbitrary-path API), timestamped backups in `~/.local/state/term-dashboard/backups/`, atomic write with mode preserved, syntax check before replace, diff confirmation, and a restore action in the UI. Tests and manual checks run with a temporary `HOME`, `XDG_CONFIG_HOME` and `GSETTINGS_BACKEND=keyfile`, and td never calls the `dconf` CLI (which ignores that variable), so they never touch the real machine.
- **A shell in the browser.** Mitigations: loopback bind; a 256-bit session token that never appears in a URL or argv (other local users can read argv because `/proc` has no `hidepid`), obtained by swapping a single-use 60 s launch code and sent as `Authorization` or the WS subprotocol; `Host` allowlist against DNS rebinding; WS `Origin` check; body and WS message size limits; validated identifiers; refuse to start the server as root.
- **Orphaned terminals.** `setpriv --pdeathsig HUP`, cleanup on SIGINT/SIGTERM/SIGHUP, and killing the shell's whole session (background jobs included), with tests for each.
- **`script` PTY edge cases** (no `script` binary, odd `$SHELL`). Mitigation: detect `script` at startup and disable only the Terminal page with a clear message; shell path comes from settings or `getent passwd`, passed through env, never interpolated.
- **Ghostty load order and includes.** Ghostty loads `config.ghostty`, then `config` (later wins). td edits the winning file, lists `config-file` includes read-only, and warns after a save when an edited key is still overridden.
- **Bundle size.** Monaco makes `web/` several MB. Acceptable for a local tool; workers and languages other than shell/plaintext are excluded.
- **`@hono/node-ws` on Bun.** [UNVERIFIED] Phase 1 checks the WS upgrade under both `node main.js` and `bun main.js`.

## Validation log
### Session 1 (2026-11-08)
- Intake (4 questions): both streaming modes; npm Node bundle; Ptyxis + GNOME Terminal; managed block for Config mode.
- Probed: see Evidence. PTY resize under Node and `bun link` were verified by running them.
- Package name `linux-term-dashboard` confirmed by the user.
- Open: node-ws on Bun (phase 1 probe with a Node fallback); Nx `continuous` targets and Monaco 0.57 worker paths (phase 1 check).

### Red-team (2026-11-08)
Report: `plans/reports/red-team-261108-0744-term-dashboard.md`. 14 findings (2 blockers, 7 major, 5 minor), all accepted and applied after spot checks: `gsettings reset-recursively`/`list-recursively` accept `SCHEMA:PATH`; `setpriv` exists; `/proc` has no `hidepid`; the oh-my-zsh template sets `ZSH_THEME` (line 11) and `plugins` (line 76) before `source` (line 78); `GSETTINGS_BACKEND=memory` returns schema defaults; Ptyxis' gschema XML holds 89 keys and Ubuntu ships a `10_ptyxis.gschema.override`.
- Blockers fixed: gsettings-only access (the `dconf` CLI would bypass the sandbox); a second oh-my-zsh block above the `source` line.
- Major fixed: launch code instead of a token in the URL; instance file for port reuse; pdeathsig + session kill + SIGHUP; package `private` and release job untouched; XML metadata + `list-recursively` + byte-capped activity history; `--dev-origin` for `dev:td`; documented Ghostty load order + include warnings + `clear` for repeatable keys.
- Minor fixed: identifier validation and 0600/0700 backups; WS size limit, try/catch and real-upgrade tests; `@linux-toolchain/core/shell` alias; phase 4 dependencies; palette picker in scope, default-terminal selection a non-goal.

### Phase 1 probe (2026-11-08)
- WebSocket upgrade, echo route bundled like `main.js` (esbuild, node22 ESM, same banner) and also run from TypeScript source with `bun`: `@hono/node-ws` 1.3.1 (`createNodeWebSocket` + `injectWebSocket`) and `@hono/node-server` 2.1.6's built-in `upgradeWebSocket` (with a `ws` 8.22.1 `WebSocketServer({ noServer: true })` passed as `websocket.server`) both upgrade and echo on Node 26.13.0 and Bun 1.4.4. No Node fallback is needed for `dev:td`. The client offered `['td', <token>]` and the server selected `td`, so the token is never echoed back in the handshake response.
- `@hono/node-ws` is deprecated (its README points to the built-in helper) and declares a peer range of `@hono/node-server ^1.19.11`, while the workspace has 2.1.6. It still works. Open for phase 3: use the built-in helper with `ws` as an explicit devDependency and drop `@hono/node-ws`.
- Nx `continuous: true` is in `nx/schemas/project-schema.json` (Nx 24.0.5). `nx show project term-dashboard-web` reports `serve` as continuous, and `bun run dev:td` started both `serve` targets: the td server on 127.0.0.1:4777 printed a launch URL on `http://localhost:5173`, and the Vite proxy forwarded `GET /api/health` and `POST /api/session` (200).
- Nx asset copying skips files matched by the root `.gitignore` (`dist`), and the esbuild executor schema rejects the per-asset `includeIgnoredFiles` flag, so a `dist/apps/term-dashboard-web` asset entry copies nothing. The CLI project therefore has an esbuild `bundle` target and a `build` target (`nx:run-commands`, depends on `bundle` and `^build`) that copies the web build into `web/`.
- Local Node is 26.13 only. Node 22.13 and 24 are covered by the CI node-compat job (phase 6).

### Execution decisions (2026-11-08)
- WebSocket: drop the deprecated `@hono/node-ws` (its peer range is `@hono/node-server ^1`) in favour of the built-in `upgradeWebSocket` of `@hono/node-server` 2 with `ws` as an explicit devDependency; the phase 1 probe showed the built-in path works on Node and Bun.
- CLI build is `bundle` (esbuild) + `build` (copies the web build into `web/`), because Nx asset copying skips gitignored `dist` paths.
- Ghostty schema: 211 distinct keys (629 key lines). Success criteria refer to every distinct key.
- Phase 4 live checks (terminal resize via `tput cols`, tab close ends the shell, theme round trip through `settings.json`) need phase 3 routes and run in phase 5 verification.
