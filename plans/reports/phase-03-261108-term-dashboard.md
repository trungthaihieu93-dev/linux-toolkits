# Phase 3 report: backend services, activity stream and PTY

Status: done. Branch `feat/td-p3`. Plan: `plans/261108-0744-term-dashboard/`.

## What was built (paths under `ubuntu/apps/term-dashboard/src/`)
- `exec/command-runner.ts`: `ProcessCommandRunner` spawns argv arrays only (`shell: false`). It publishes `started`, `output` (one event per decoded chunk, per stream) and `exited` (code, signal, duration, error), returns the full stdout/stderr to the caller (capped at 32 MB), and reports a missing binary as `notFound`. Timeouts kill with SIGKILL. `RecordingCommandRunner` records calls and answers from a responder.
- `exec/activity-bus.ts`: pub/sub with a history ring of 500 commands and 2 MB (whole commands are evicted). Output past 64 KB per command is dropped. When the command exits, one `output` event with `truncatedBytes` stands in for the dropped bytes, and the cut lands on a UTF-8 boundary.
- `server/routes/activity.ts`: `GET /api/activity` is SSE-formatted (`data: <json>`). It subscribes and snapshots history in the same tick, so no event is lost or sent twice. Live events follow, with a `: heartbeat` comment every 15 s. A client that falls 10,000 events behind is dropped and replays history when it reconnects.
- `files/file-store.ts` + `files/preview.ts`: allowlisted ids resolve against `HOME`/`XDG_CONFIG_HOME`. A write does: mtime check (409), then a temp file in the target folder with the target's mode, then the check through CommandRunner (`bash -n`, `zsh -n`, `ghostty +validate-config --config-file=`). A failed check returns 422 with the output (temp path replaced by the real path); the temp file is removed and nothing else changes. Then the mtime is checked again, the current file is backed up, and the temp file is renamed over the target. Backups go to `<state>/term-dashboard/backups/<YYYYMMDDTHHMMSSZ[-N]>/<id>`; the folders are 0700 and the files 0600. Symlinks that lead outside the roots are refused, including folder symlinks anywhere on the path; symlinks inside HOME are followed and the real file is written. Restore goes through `write`, so it takes a backup first. The preview returns a unified diff (`diff` package) and the check result.
- `gsettings/gsettings-service.ts`: uses `gsettings` only. Schema XML comes from `$XDG_DATA_HOME` and `$XDG_DATA_DIRS` (`glib-2.0/schemas`) and is parsed once per run. A view costs one `list-recursively SCHEMA[:PATH]` plus one `GSETTINGS_BACKEND=memory` listing, and the memory listing is cached per schema id. Values are validated before `set` (GVariant type, enum, flags, range, choices). Profiles can be listed, created (32-hex uuid for Ptyxis, dashed for GNOME Terminal), duplicated (non-default keys), deleted (never the default; removed from the list, then `reset-recursively`) and set as default. A JSON backup of every installed terminal (global, shortcuts, every profile, non-default keys) is taken before the first write of a run. Restore checks the whole backup first. It then resets profiles created after the backup, runs `reset-recursively` on every saved schema/path, and sets the saved keys again.
- `ghostty/ghostty-service.ts`: `version`, schema (`+show-config --default --docs`, cached per version), themes, fonts, `config()` (both files in load order with entries, includes, conflicts and the effective config), `preview` and `save`. A key is edited in the file that sets it. When both files set it, the winning `config` file is edited, with a notice. New keys go to `config` when it exists, else `config.ghostty`. `setList` moves repeatable keys into one file (`keybind = clear` passes through), and `unset` removes the key from both files. `config-file` is read-only. A save checks every candidate before writing any file. Afterwards it compares the edited keys with `+show-config` and warns when an include or the other file still overrides one.
- `shell/shell-service.ts`: `ShellFileView` (term-config `analyzeShellFile`), Config-mode preview/save (`applyShellModel` re-rendered over the current file) and raw preview/save. It also serves the oh-my-zsh catalog (`$ZSH` or `~/.oh-my-zsh`, plus `custom/`) and shape-checks `ShellBlockModel` request bodies.
- `settings/settings-store.ts`: `$XDG_CONFIG_HOME/term-dashboard/settings.json`. Partial updates are validated (400 on unknown fields or wrong types). Invalid fields fall back to defaults on read, and writes are atomic (0600).
- `pty/pty-session.ts`, `pty/pty-manager.ts`, `pty/process-tree.ts`: `setpriv --pdeathsig HUP -- script -qfec 'exec "$TD_SHELL" -il' /dev/null`, `detached`, `TERM=xterm-256color`, `cwd=HOME`. The shell is found through `/proc/<script>/task/*/children` and the tty on its fd 0. Resizes run `stty -F <tty> cols C rows R` one at a time, latest size only. On close, both sessions (script's and the shell's) get SIGHUP, and SIGKILL after 2 s. The manager allows at most 4 sessions (5th: error message + 1013), refuses with 1009 on messages over 64 KB, and ends every session on shutdown.
- `server/routes/*.ts`: settings, inventory, gsettings (`/api/terminals/:kind/...`), ghostty, shells (including `GET /api/shells/:shell/oh-my-zsh` from phase 5), backups, activity and pty (WS). Every path and body identifier is validated (term-config `validate.ts` plus shape checks); invalid input returns 400. `errors.ts` maps service errors to 400/404/409/422/503.
- Wiring: `app.ts` takes optional `services` and registers the routes (1 MB body limit on the shell and Ghostty save routes). `listen.ts` passes a `ws` `WebSocketServer({ noServer, maxPayload: 64 KB, handleProtocols → 'td' })` to `@hono/node-server`'s built-in `upgradeWebSocket`. `start.ts` registers the PTY cleanup last, so it runs first on SIGINT/SIGTERM/SIGHUP. `main.ts` builds the services from `process.env` and `homedir()`.
- Dependencies: `@hono/node-ws` was removed, and `ws` 8.22.1 and `@types/ws` 8.18.2 were added as devDependencies. The published manifest still has no `dependencies`.
- `libs/term-config/src/api.ts` (compatible additions only): it documents 422 and 503, adds `BackupRestoreRequest`, and adds `API_PATHS.terminalProfileDuplicate`, `terminalProfileDefault`, `terminalReset` and `backupFileAction` (covered by `api.spec.ts`).

## Commands and results (from `ubuntu/` in the worktree)
- `bun --bun nx run-many -t lint test build -p term-dashboard term-config --skip-nx-cache` exited 0. term-dashboard: 22 files and 171 tests, none skipped (every binary is installed here). term-config: 11 files and 174 tests. There were no lint warnings.
- `bun run lint && bun run test && bun run build && bun run format:check` exited 0 (lint 6/6, test 6/6, build 4/4, format check clean).
- The Nx daemon on this machine hit the OS inotify watch limit, so both runs used `NX_DAEMON=false`. The daemon was stopped.
- Integration specs that need binaries use `describe.skipIf`/`it.skipIf`, so they report as skipped when a binary is missing. Here all of them ran:
  - gsettings keyfile round trip: create, duplicate and delete a profile, back up, change keys, restore, and compare `list-recursively`.
  - real `ghostty +validate-config`.
  - PTY: `42`, `stty size` = `43 132`, and `sleep 300 &` killed on close (`pgrep -s <sid>` exits 1).
  - td run as a child process from source under Bun and stopped with SIGHUP (129) and SIGINT (130): the session is gone afterwards.
  - Real WebSocket: a foreign Origin gets 403, a missing token gets 401, the server answers with the `td` subprotocol, an oversized message closes with 1009, and td shutdown ends the terminals.

## Sandbox walkthrough
The built bundle (`node dist/apps/term-dashboard/main.js --no-open --port 0`, the same file `link:td` exposes) ran twice. Each run used a temporary `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_RUNTIME_DIR` and `GSETTINGS_BACKEND=keyfile`. Through the API:
- Inventory reported Ghostty and Ptyxis (with schemas), no GNOME Terminal, and the PTY as available.
- A zsh alias was previewed (zsh check ok) and saved into the sandbox `.zshrc`.
- A Ptyxis profile was created (201) and `audible-bell=false` was set (it appears in the sandbox keyfile). An invalid enum value got 400.
- A Ghostty theme was previewed and saved, with no warnings.
- The gsettings JSON backup was listed, and the backups folder is mode 700.
- The activity stream replayed 61 to 73 events covering every command (`zsh -n`, `gsettings`, `ghostty`, `ptyxis --version`).
- A PTY over WebSocket started the login shell (zsh) with protocol `td`, applied a resize, and started `sleep 300 &`.

Stopping td with SIGINT gave exit 130 and SIGHUP gave exit 129. In both runs the WebSocket closed with 1000, the shell's session was empty, `pgrep -fu $USER 'script -qfec'` found nothing, and the instance file was removed.

Checksum comparison: `sha256sum ~/.zshrc ~/.bashrc ~/.config/ghostty/config ~/.config/ghostty/config.ghostty` and a read-only `dconf dump /org/gnome/Ptyxis/ | sha256sum` were taken before any work and again after all tests and walkthroughs. They are identical (5 of 5 entries). Afterwards, `pgrep -fa 'term-dashboard|script -qfec|vite'` showed no process started by this phase.

## Deviations
- **Session kill through `/proc` instead of `pkill -HUP -s`.** td scans `/proc/*/stat` for the session id and signals each pid. This needs no new process while td is shutting down on a signal. It covers both the shell's session and script's own (detached) session, and it refuses sid ≤ 1 and td's own session. The specs still verify the result with `pgrep -s <sid>`.
- **Check before backup.** The phase file lists backup → temp → check → rename. td checks first, then backs up, then renames, so a failed check leaves no stray backup. The original file is untouched either way.
- **Backups honour `$XDG_STATE_HOME`** (default `~/.local/state`), so a sandbox state folder is respected.
- **`SHELL` is set to the terminal shell for `script`.** `script -c` runs the command with `$SHELL -c`, and the interactive shell then sees its own path in `$SHELL`.
- **gsettings JSON backups store non-default keys only.** Restore = `reset-recursively` + set the saved keys. This reaches the same state without writing defaults into the database.
- **Ghostty list and unset edits can change both files.** `setList` consolidates a repeatable key into the winning file (with a warning), and `unset` removes the key from both files, so the effective config matches the edit.
- **Resize goes through CommandRunner.** `stty` calls appear in the activity stream, one per applied size.
- **Route responses not fixed by the contract:** gsettings `PUT`/`reset` return the refreshed `GSettingsSchemaView`; create/duplicate return 201 `ProfileCreated`; set-default and delete return 204. The file restore route accepts an optional `{ baseMtimeMs }` body (`BackupRestoreRequest`).
- **GNOME Terminal schema ids are unverified.** GNOME Terminal is not installed here. The ids follow gnome-terminal's schema (`Legacy.Settings`, `Legacy.Keybindings`, `ProfilesList` `list`/`default`, `Legacy.Profile` at `/org/gnome/terminal/legacy/profiles:/:<uuid>/`, label `visible-name`). At runtime td uses a schema's own XML path when it declares one, so a non-relocatable schema still works.
- The phase file status in `plans/` was not changed. The orchestrator should update it with `ak plan`.

## Unresolved questions
- None blocking. The GNOME Terminal ids should be confirmed on a machine that has it installed.
