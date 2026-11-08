# Red-team review: term-dashboard (`td`) plan

- Plan: `plans/261108-0744-term-dashboard/` (plan.md, phase-01..06)
- Date: 2026-11-08 (Asia/Saigon)
- Personas: Assumptions (A), Failure modes (F), Scope (S), Security (Sec)
- Fixed user decisions respected: both streaming modes, npm Node bundle (no node-pty, no bun --compile), Ptyxis + GNOME Terminal, managed block for Config mode.
- All probes were read-only against the real user, or ran in the session scratchpad. Nothing was written to real dotfiles or dconf.

## Verdict

The plan is not ready to execute. Two blockers: (1) the "sandboxed" gsettings tests and walkthroughs would write to the user's real dconf, and the dconf backup taken in a sandbox would be empty; (2) Config mode cannot set oh-my-zsh theme or plugins from a block at the end of `.zshrc`. Seven major findings cover the token leaking to other local users, port reuse, PTY orphans, release auto-publish, N+1 process spawns flooding the activity stream, dev mode not working with the guard, and Ghostty precedence and includes.

---

## 1. BLOCKER: dconf CLI ignores the sandbox; "tests never touch the real machine" is false (F, A)

**Where:** phase-03 `gsettings/gsettings-service.ts` (delete = `dconf reset -f`, backup = `dconf dump`, restore = `dconf load`); phase-03 Verification (manual sandbox run); phase-05 step 3 and Verification; plan.md Risks ("Tests and manual checks run with ... `GSETTINGS_BACKEND=keyfile`, so they never touch the real machine"); phase-06 AGENTS.md invariant.

**Problem:** `GSETTINGS_BACKEND=keyfile` only affects GSettings clients. The `dconf` CLI ignores it. dconf reads the db file under `$XDG_CONFIG_HOME/dconf/user`, but sends every write over D-Bus to the per-user `dconf-service`, which runs with the real session's environment. In a sandbox, `gsettings set` goes to the keyfile, `dconf dump` reads an empty sandbox db, and `dconf reset -f` / `dconf load` write to the **real** `~/.config/dconf/user`. The phase-05 step 3 test (profile delete) and the "Restore backup" path would change real Ptyxis settings while the checksum check compares a sandbox the code never wrote to. There is a second bug: `dconf load` merges, so restoring does not remove profiles or keys created after the dump.

**Evidence:**
- Real `dconf dump /org/gnome/Ptyxis/` gives 4 lines.
- With `HOME/XDG_CONFIG_HOME=<tmp> GSETTINGS_BACKEND=keyfile` it gives 0 lines. The read side follows the env.
- `dconf-service` (pid 3937) runs as the real session's writer.
- `gsettings get org.gnome.Ptyxis profile-uuids` gives `@as []` under keyfile and `['91d0…']` for real.
- Write behaviour comes from dconf's design (writer service over D-Bus). I did not test it, because that would mean writing to the real dconf.

**Fix (plan text):** Remove the `dconf` binary from GSettingsService entirely and use only `gsettings`, which honours the backend:
- profile delete: `gsettings reset-recursively <schema>:<path>` (verified present: `gsettings help reset-recursively` accepts `SCHEMA[:PATH]`), then remove the uuid from the list.
- backup: `gsettings list-recursively <schema>[:<path>]` for the global schema, the shortcuts schema and each listed profile, saved as JSON `{schema, path, key, value}` in the backups folder.
- restore: reset-recursively, then `gsettings set` each saved key, and remove profiles that are not in the saved uuid list.
- Add a FileStore-style guard: refuse to start the GSettings service when `GSETTINGS_BACKEND` is set but `XDG_CONFIG_HOME` points at the real home. Add an invariant to AGENTS.md: "td never invokes `dconf`".
- The sandbox checks must also note that a fresh keyfile sandbox has no Ptyxis profiles (`@as []`). The UI and tests must handle an empty `profile-uuids` and an empty `default-profile-uuid`.

## 2. BLOCKER: oh-my-zsh theme and plugins in an end-of-file block have no effect (A, F)

**Where:** phase-02 `shell/managed-block.ts` ("Insert at end of file when missing"); phase-02 `shell/model.ts` (`ohMyZsh?: { theme?, plugins? }`); phase-05 Config mode "Theme ... and Plugins"; plan.md success criterion for shell pages.

**Problem:** oh-my-zsh reads `ZSH_THEME` and `plugins` only while `source $ZSH/oh-my-zsh.sh` runs. A block appended after that line sets the variables too late. The theme and plugin pickers would save, pass `zsh -n`, show a clean diff, and change nothing. The round-trip and `zsh -n` tests in phase 2 cannot catch this.

**Evidence:** `~/.oh-my-zsh/templates/zshrc.zsh-template`: `ZSH_THEME=` on line 11, `plugins=(git)` on line 76, `source $ZSH/oh-my-zsh.sh` on line 78.

**Fix (within the managed-block decision):** Use two managed blocks in `.zshrc`:
- `# >>> term-dashboard-omz >>>` holds only `ZSH_THEME`/`plugins`. It is inserted immediately **before** the first `source "$ZSH/oh-my-zsh.sh"` (or `source $ZSH/oh-my-zsh.sh`) line. If no such line exists, the oh-my-zsh section is disabled with a message.
- `# >>> term-dashboard >>>` keeps aliases, exports, PATH and history at the end, so it still overrides oh-my-zsh aliases.

Add an integration spec: with a temp `HOME` containing a minimal fake `$ZSH/oh-my-zsh.sh` that echoes `$ZSH_THEME $plugins`, run `zsh -ic exit` and assert that the picked values are printed. Update the success criterion to say "theme/plugins take effect", not just "edits".

## 3. MAJOR: the session token leaks to every local user through process argv (Sec)

**Where:** phase-01 "Server shell behaviour" (token in `http://127.0.0.1:<port>/#t=<token>`, opened with `xdg-open`); plan.md Risks ("A shell in the browser").

**Problem:**
- The full URL, fragment included, is an argv element of `xdg-open` and then of the browser. If the browser was not already running, it stays in the browser's argv for the browser's whole lifetime.
- `/proc/<pid>/cmdline` is world-readable without `hidepid`, so any local account (or a sandboxed process running as another uid) can read the token with `ps aux`.
- WebSocket `Origin` checks only stop browsers. A non-browser client sends any `Origin` it likes. So the leaked token plus a forged `Origin` gives an interactive shell as the user.
- The token is also valid for the whole run, so it is never invalidated.

**Evidence:** `findmnt -no OPTIONS /proc` shows `rw,nosuid,nodev,noexec,relatime` (no `hidepid`). The default browser is `google-chrome.desktop`, which keeps launch URLs in argv.

**Fix (plan text):** Split it into two secrets:
- **Bootstrap nonce:** single-use and valid for 60 s. It is the only secret in the printed and opened URL (`/#n=<nonce>`).
- **Session token:** the page POSTs the nonce to `/api/session` (Host-checked, nonce in the body), receives the session token in the JSON response, stores it in `sessionStorage`, and clears the fragment. The server then invalidates the nonce.

A leaked argv is then useless after the first page load. Add a guard spec: the second use of a nonce returns 401. A stale nonce returns 401. A new tab can get in again through the `td` re-open flow in finding 4. Optional: replace `EventSource ?t=` with a `fetch()` stream (headers allowed) so the session token never appears in a URL. This is minor; Hono logs nothing by default.

## 4. MAJOR: port reuse opens a tokenless page and trusts any process on 127.0.0.1:4777 (Sec, F)

**Where:** phase-01 "On `EADDRINUSE` ... open that URL path without a token and exit 0"; plan.md success criterion "opens that one instead of starting a second server".

**Problem:**
- The opened page has no token, so it shows only the 401 "Session expired" screen from phase 4. The feature does not work.
- The check trusts any listener whose `/api/health` says `term-dashboard`. On a shared machine, user B's `td`, or a fake server answering health on the fixed default port 4777, makes user A's `td` open A's browser on B's origin. B then controls the UI A is looking at.

**Fix (plan text):**
- The running `td` writes `$XDG_RUNTIME_DIR/term-dashboard/instance.json`. The file has mode 0600 and the directory is 0700; `/run/user/<uid>` is already 0700, as verified. The file holds `{ port, pid, launchSecret }`.
- On `EADDRINUSE`, the new invocation reads that file and checks that the pid is alive and that `port` matches. It POSTs `launchSecret` to `/api/launch`, which mints a bootstrap nonce (finding 3), and opens the resulting URL.
- If the file is missing or does not match, treat the listener as foreign and exit 1 with the `--port` hint. Delete the file on clean exit.
- Remove `pid` from the unauthenticated `/api/health`, or keep it but stop relying on health for identity.

## 5. MAJOR: PTY sessions outlive `td` when it is killed or its terminal closes (F)

**Where:** phase-03 `pty/pty-session.ts` ("On WS close, `td` exit or child exit: SIGHUP then SIGKILL to the process group"); phase-01 "SIGINT/SIGTERM: ... run registered cleanups"; phase-03 step 6 and Verification (`grep -c 'script -qfec'`).

**Problem:** Cleanup runs only on SIGINT and SIGTERM.
- Closing the terminal window that runs `td` sends SIGHUP, which Node's default handling turns into an immediate exit with no cleanup. SIGKILL and OOM kills also skip cleanup.
- I probed this. When the parent goes away (stdin EOF, stdout closed), `script` keeps running, and so does the shell's foreground job.
- The `script` child calls `setsid()`, so the shell is not in `script`'s process group. The spec `process.kill(-pgid, 0)` only proves that `script` is gone.
- `script -c` runs the command through `$SHELL -c`, per `man script`. An inherited exotic `$SHELL` (nushell, xonsh) would break `exec "$TD_SHELL" -il`.

**Evidence:** I ran a scratch probe (`node` spawning `script -qfec 'exec "$TD_SHELL" -i' /dev/null`, `detached: true`, temp `HOME`):
- Case A: `kill(-pgid, SIGKILL)` killed `script`, and the shell died from the hang-up. That path is OK.
- Case B: started `sleep 300`, then closed stdin and stdout. After 1.5 s `script` was still alive and `sleep 300` was still running, in its own session.

Also verified: `setpriv` (util-linux 2.41.3) supports `--pdeathsig`.

**Fix (plan text):**
- Spawn `setpriv --pdeathsig HUP script -qfec 'exec "$TD_SHELL" -il' /dev/null` with `SHELL=/bin/sh` for `script`, and set `SHELL=$TD_SHELL` inside the command (`SHELL="$TD_SHELL" exec "$TD_SHELL" -il`).
- Handle `SIGHUP` alongside SIGINT/SIGTERM.
- Record the shell's pid and sid at start, and on cleanup send `kill(-sid, SIGHUP)` then SIGKILL after 2 s.
- The spec must assert that the **shell pid** and a background `sleep` started in the session are gone after (a) WS close and (b) SIGKILL of a `td` child process used as a harness.
- Replace the `grep -c 'script -qfec'` check with `pgrep -s <recorded sid>` being empty.

## 6. MAJOR: merging the feature auto-publishes `linux-term-dashboard`, and the release design doesn't match the job (S, F)

**Where:** phase-06 "Modify the `release` job: loop over both package folders (`dist/apps/...`)" and "extend `smoke`"; plan.md Non-goal "No first npm publish without the maintainer's go-ahead".

**Problems:**
- (a) The release job publishes any version that is not on npm yet. The new package's first version is by definition unpublished, so merging the phase-6 PR to `main` **publishes it**, which breaks the non-goal.
- (b) The job does not build or read `dist/`. It downloads the single `package` artifact from `checks` and errors unless there is exactly one `.tgz` ("Expected exactly one .tgz"). It also hard-codes the `linux-toolchain` name check and the tag. "Loop over dist folders" does not fit that design.
- (c) Trusted publishing cannot be configured on npmjs.com before a package exists. The fallback `NPM_TOKEN` is a granular token that may be scoped to `linux-toolchain` only, so the first publish can fail mid-job.
- (d) `smoke` runs in `ubuntu:24.04` as root, and phase 1 says `td` refuses to run as root. Unless the refusal applies only to server start, `npx ./linux-term-dashboard-*.tgz --version` fails there.

**Evidence:** `.github/workflows/ci.yml`, release job steps "Read the package version", "Verify the tarball name and version", "Tag the release"; smoke `container: ubuntu:24.04`.

**Fix (plan text):**
- Ship `apps/term-dashboard/package.json` with `"private": true`. The release job skips private packages, and the maintainer's go-ahead PR removes the flag.
- Upload a second artifact (`package-td`) from `checks`. Turn the release steps into a matrix over `{name, dir, artifact}`, keeping the per-package name check and tag, with the linux-toolchain row unchanged.
- Note that the first td publish needs a token with "all packages" or "new package" scope, and that the trusted publisher is added after the first publish.
- Apply the root refusal only to the server command (`--help`/`--version` run as root). Run the td tarball check in `checks` or `node-compat`, not in the root `smoke` container.

## 7. MAJOR: N+1 process spawns flood the activity stream and push out its 500-event history (F, perf)

**Where:** phase-03 `schemaView` ("`list-keys`, `range`, `describe` and `get` per key; the default comes from `GSETTINGS_BACKEND=memory gsettings get …`"); phase-03 `activity-bus.ts` (ring buffer of 500 events); `ghostty-service.ts` `schema()`/`themes()`/`fonts()`.

**Problem:**
- Ptyxis has 27 + 40 (Shortcuts) + 22 (Profile) = 89 keys. At five spawns per key that is about 445 processes per full page load, and each one makes at least 2 activity events (started/exited). One page view evicts the whole 500-event history. Every additional profile adds 110 spawns.
- `ghostty +show-config --default --docs` is 185,943 bytes. It and the 819-line theme list go to every SSE client as output chunks. The buffer is capped by event count, not bytes, so replay on reconnect can be tens of MB.

**Evidence:** `gsettings list-keys` counts (27/40/22); `ghostty +show-config --default --docs | wc -c` = 185943.

**Fix (keeps "stream every command"):**
- Values: one `gsettings list-recursively <schema>[:<path>]` per schema or profile (verified to print `schema key value`).
- Defaults: one `GSETTINGS_BACKEND=memory gsettings list-recursively <schema>`.
- `range`/`describe`: cache per schema for the process lifetime, since they don't change at runtime.
- Cap the ring buffer by bytes (for example 2 MB) as well as by count. Truncate stored and replayed output to the first and last 8 KB per command, with a "truncated N bytes" marker. Live clients still see the argv and exit code for every command.
- Add a spec asserting that `schemaView(Ptyxis)` makes at most 4 command calls.

## 8. MAJOR: `dev:td` cannot work with the guard as specified (A)

**Where:** phase-01 scripts `dev:td` (Vite serve plus CLI serve on 4777), `vite.config.mts` "dev proxy `/api` and `/ws`", and guard rules; phase-04 step 5 (screenshots "with `bun run dev:td` running").

**Problems:**
- Vite's proxy forwards `Host: localhost:5173` unless `changeOrigin: true`, so the guard returns 403.
- The proxied WS carries `Origin: http://localhost:5173`, so the Origin check rejects it.
- The token printed by the CLI belongs to a `127.0.0.1:4777` URL, but the browser is on 5173 with no fragment.
- `/ws` needs `ws: true` in the proxy entry.
- `dev:td` runs the server under **Bun**. `@hono/node-ws` on Bun is still marked UNVERIFIED and has no fallback, so the Terminal page may not work in dev at all.

An implementer facing all of this will likely add an ad-hoc auth bypass.

**Fix (plan text):**
- Add a hidden `--dev-origin <url>` flag, used only by the `serve` target. It adds that origin to the Host and Origin allowlists, and makes the CLI print `http://localhost:5173/#n=<nonce>`.
- Proxy entries use `changeOrigin: false` with the dev origin allowlisted, and `ws: true` for `/ws`.
- State the fallback if the phase-1 probe fails on Bun: the CLI `serve` target runs `esbuild --watch` output under `node`.
- Add a guard spec that `--dev-origin` is rejected unless explicitly passed.

## 9. MAJOR: Ghostty precedence is documented; the real risks are includes and repeatable keys (A, F)

**Where:** plan.md Risks "[UNVERIFIED] which of `config` and `config.ghostty` wins" and the phase-03 probe that uses `--config-file` in both orders; phase-03 `save(edits)` file choice; phase-05 Ghostty page "repeatable keys as lists".

**Problems:**
- The Ghostty docs say XDG `config.ghostty` loads first and then `config`, so `config` wins. The `--config-file` probe tests explicit flag order, not the default load order, so it adds nothing.
- The plan ignores `config-file` includes. They are processed at the end of the file that contains them and override that file's keys. A key set in an include (for example `config-file = themes/local`) is in neither top-level file, so td writes it to `config.ghostty`. There it is overridden first by `config` and then by the include, and the edit silently has no effect, even though `+show-config` shows the overriding value.
- For repeatable keys (`keybind`, `palette`, `font-family`), removing a row from a list built from defaults plus the file cannot remove a default. Ghostty needs `keybind = clear` or `<trigger>=unbind`.

**Evidence:**
- ghostty.org/docs/config: load order and include semantics.
- `ghostty +validate-config --help` confirms the `--config-file` flag.
- Scratch probe: validating a temp file resolves a relative `config-file` include next to it, an unknown key exits 1 (`bogus-key: unknown field`), and a valid file exits 0. The FileStore check design is therefore sound.

**Fix (plan text):**
- Replace the Risk entry with the documented order.
- The `files()` model follows `config-file` includes (relative to the containing file, `?` optional, with a cycle guard) and records which file sets each key last.
- `save()` writes to the last-effective file when that file is allowlisted. Otherwise it writes to `config` (last loaded) and shows a warning that an include sets the key.
- After each save, re-run `+show-config` and flag any edited key whose effective value differs from the staged one.
- Repeatable-key editing marks default entries as "default" and serialises removals as `unbind`/`clear` according to the key's docs.

## 10. MINOR: client-supplied path components are not validated; backups hold secrets with no stated mode (Sec, F)

**Where:** phase-03 `restore(id, backupTs)`, `/api/terminals/:kind/...` (schema, path, uuid, key), backups folder.

**Problem:** "ids, not paths" covers the file id, but `backupTs` is joined into a filesystem path and the gsettings `path`/uuid go into `schema:path` argv. A `../` in `backupTs` would turn restore into "write any readable file into `.zshrc`". The PTY already gives an authenticated client a shell, so this is a correctness and defence-in-depth issue, not an auth bypass. Separately, backups of `.zshrc`/`.bashrc` often contain exported tokens, and the plan does not say what mode the backups get.

**Fix:**
- Validate `backupTs` against the exact ISO pattern the server generates, and resolve it within the backups root.
- Validate `uuid` against `^[0-9a-f]{32}$` (Ptyxis) or the dashed UUID form (GNOME Terminal), and require it to be in the current uuid list.
- Accept `schema`/`key` only from the server-built inventory.
- Create the backups directory as 0700 and files as 0600. Prune to the last N backups per id.

## 11. MINOR: `@hono/node-ws` upgrade path is not covered by the planned guard tests (A, F)

**Where:** phase-01 step 4 ("WS origin rejection" via `app.request()`); phase-03 PTY route.

**Problem:**
- In `@hono/node-ws`, the upgrade handler runs `await app.request(...)` with no try/catch, so a throw in the guard becomes an unhandled rejection that can bring down `td`.
- It creates `new WebSocketServer({ noServer: true })` with no `maxPayload` (ws default 100 MiB).
- Subprotocol selection uses ws's default, which echoes the first offered protocol (the token), so the browser handshake works.
- `app.request()` unit tests never exercise the raw socket path that writes the 403.

**Evidence:** `honojs/middleware` `packages/node-ws/src/index.ts`: upgrade handler, `noServer: true`, no protocol handling.

**Fix:**
- Wrap guard logic so it never throws (it returns a response).
- Have `pty` reject frames above 64 KB.
- Add an e2e case using a real WS client against the built bundle: foreign `Origin` gets the socket closed with 403, a missing or wrong subprotocol token is rejected, and the correct token gets 101 with `Sec-WebSocket-Protocol` echoed.

## 12. MINOR: `term-config` pulls the Node-only core barrel, and the web app needs a path alias (A)

**Where:** phase-02 `shell/model.ts` ("`shQuote` from `@linux-toolchain/core`"); phase-04 `lib/api.ts` imports `@linux-toolchain/term-config`.

**Problem:** `libs/core/src/index.ts` re-exports `runner`, `context` and `system`, which import `node:` modules. Any runtime (non-type) import of `@linux-toolchain/term-config` from the web app drags those into a browser bundle. Vite also does not resolve `tsconfig.base.json` `paths` unless it is configured to.

**Fix:**
- State that the web app imports term-config with `import type` only, enforced by an eslint `no-restricted-imports` rule or `@typescript-eslint/consistent-type-imports`.
- Alternatively, make term-config import `shQuote` from `libs/core/src/shell.ts` through a dedicated path alias and give term-config an `api` subpath.
- Add an explicit Vite `resolve.alias` (or the tsconfig-paths option) in phase 1.

## 13. MINOR: Phase 4 depends on Phase 3 for its own verification (S)

**Where:** plan.md Phases table ("4 depends on 1 ... can run in parallel with phases 2 and 3"); phase-04 Terminal page and Verification ("`tput cols` changes after resizing", "closing the tab ends the shell process", settings persisted in `settings.json`).

**Problem:** The PTY WS route, SettingsStore and the activity SSE are built in phase 3. Phase 4 cannot pass its verification without them.

**Fix:** Mark phase 4 as depending on 1 (build) and 3 (verification), or move the Terminal-page and theme-persistence checks to phase 5 Verification.

## 14. MINOR: "all native terminal configs" leaves out two Ubuntu-native config surfaces (S)

**Where:** plan.md Overview and Non-goals; requested scope "manage all Ubuntu-native-terminal + ghostty configs".

**Problem:** The plan covers Ptyxis and GNOME Terminal gsettings only. It does not mention (a) Ptyxis user palette files, which I believe live under `$XDG_DATA_HOME/org.gnome.Ptyxis/palettes/` (not verified here), or (b) the default-terminal selection (`xdg-terminal-exec` list / `x-terminal-emulator`), which is the main "which terminal opens" setting on recent Ubuntu.

**Fix:** Either add both to scope with an allowlisted file id, or list them explicitly in Non-goals so the gap is a decision, not an omission. Ask the user.

---

## Checked and rejected (no finding)

- **Nx esbuild assets from another project's `dist`:** `nx.json` `targetDefaults["@nx/esbuild:esbuild"]` has `dependsOn: ["^build"]` and `^production` inputs. With `implicitDependencies: ["term-dashboard-web"]`, the web build runs first and invalidates the cache.
- **`ghostty +validate-config --config-file`:** exists. Exit codes and relative includes behave as needed (scratch probe).
- **WS token as subprotocol:** ws echoes the first offered protocol by default, and base64url characters are valid HTTP token characters.
- **SSE `?t=` token:** Hono has no logger by default, and EventSource URLs do not enter browser history. Low risk once finding 3 is applied.
- **CSRF and DNS rebinding:** a bearer header plus the Host allowlist covers them. No CORS headers are planned.
- **Not verified (tools absent or blocked):**
  - GNOME Terminal schema names: not installed here. The names in the plan match upstream as far as I know.
  - Nx 24 `continuous` targets: I could not read Nx's schema because local `node_modules` reads were blocked.
  - Monaco 0.57 ESM worker paths: not checked, for the same reason.

## Unresolved questions

1. Package name `linux-term-dashboard`: still awaiting the user's confirmation (plan says "needs confirmation").
2. Should Ptyxis palettes and default-terminal selection be in scope (finding 14)?
3. For finding 2: is a second managed block (`term-dashboard-omz`) acceptable under the "managed block" decision, or does the user prefer in-place editing of the existing `ZSH_THEME=`/`plugins=` lines?
