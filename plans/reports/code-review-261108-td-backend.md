# Code review: td backend (feat/term-dashboard)

Date: 2026-11-08 (Asia/Saigon). Reviewer: code-reviewer (read-only).
Diff: `git diff main...HEAD` in `/home/tonythai93/Projects/toolkits-wt/term-dashboard`.

## Scope

- `ubuntu/apps/term-dashboard/src/**`, `e2e/**`, `project.json`, `package.json`
- `ubuntu/libs/term-config/src/**` (fixtures skipped)
- `ubuntu/package.json`, `ubuntu/tsconfig.base.json`
- Not covered: web UI, CI, docs (another reviewer has them)

Checks I ran:

- `bun --bun nx run-many -t test -p term-dashboard term-config --skip-nx-cache`: all pass (22 + 11 files).
- A guard probe with path variants (`//api/x`, `/API/x`, `/api%2fx`, `/%61pi/x`, `//ws/pty`). None reached a protected handler; they fall through to static.
- `zsh -n` with a hostile `ZDOTDIR/.zshenv`: the startup file does not run.
- `bash -n` against `dash -n` on bash-only syntax: bash accepts it, dash rejects it.

## Overall assessment

The trust boundary is mostly sound. Host and Origin allowlists, Bearer auth on every `/api` route, the token required as a WS subprotocol, argv-only execution, id-to-path allowlisting, symlink containment, shQuote on every rendered value, and newline and marker rejection all hold. The tests cover the handshake and auth paths.

The defects I found are elsewhere:
- one real local-attacker path to the session token (the launch code is visible in other processes' argv);
- two data-loss paths: gsettings restore without a fresh backup, and lossy UTF-8 round-tripping of rc files;
- unbounded PTY output buffering;
- lost updates under concurrent saves.

---

## High

### H1. The launch code is visible in other users' process lists, and redeeming it gives the long-lived session token (and a shell)

Code:
- `apps/term-dashboard/src/cli/start.ts:156,166`, `start.ts:90-92` (second-td path)
- `apps/term-dashboard/src/cli/open-browser.ts:355`
- `apps/term-dashboard/src/server/session.ts:170-179`

What happens:
- `openUrl` runs `xdg-open http://127.0.0.1:<port>/#c=<code>`.
- The code is in the argv of `xdg-open` and then of the browser launcher process (`firefox <url>` / `google-chrome <url>`).
- On stock Ubuntu (`/proc` mounted without `hidepid`), every local user can read `/proc/<pid>/cmdline`.
- Loopback is shared by all users on the host, so the session token is the only barrier.

Failure scenario (shared or multi-user machine, or any other local account or compromised service user):
1. The attacker polls `/proc/*/cmdline` for `#c=`.
2. They `POST /api/session {"code":…}` with `Host: 127.0.0.1:4777` and no Origin, which the guard allows.
3. They do this before the victim's browser has loaded the page and redeemed the code. Loading the page takes hundreds of ms, the attacker needs about 1 ms.
4. The attacker receives the run's only session token. `redeemLaunchCode` returns the same token for every code and never rotates it.
5. They open `/ws/pty` with a forged `Origin: http://127.0.0.1:4777` and the token as a subprotocol, and get an interactive login shell as the victim. They can also rewrite the victim's rc files.
6. The victim only sees "invalid or expired launch code" and runs `td` again.

The README says the token "never appears in a URL or in a process argument list". That is literally true, but the single-use code that converts into the token does appear in argv.

Fix (pick one):
- Use Jupyter's pattern (best). Write a 0600 HTML file in `$XDG_RUNTIME_DIR/term-dashboard/` that redirects (meta refresh or `location.replace`) to `http://127.0.0.1:<port>/#c=<code>`, and pass only its `file://` path to `xdg-open`. The code then exists only in a file other users cannot read and in browser memory.
- Also issue a distinct token per redemption, so a leak can be detected and revoked. And print a line on td's stderr each time a code is redeemed, so a redemption the user did not make is visible.

---

## Medium

### M1. A gsettings restore takes no backup of the current state after the first change of a run, so a mistaken restore loses all of that run's work

Code: `apps/term-dashboard/src/gsettings/gsettings-service.ts:642-653` (`ensureBackup` caches `backupDone` for the run), `:799` (`restore` calls `ensureBackup`).

Scenario:
1. The user starts td and changes a Ptyxis setting at 10:00. Backup B0 captures the state before that change.
2. Over the next hour they edit profiles and shortcuts.
3. They click "Restore backup" on B0, or any older backup.
4. `restore` sees `backupDone` already set and takes no snapshot. It runs `reset-recursively` and re-sets the values, and the hour of changes is unrecoverable.

This contradicts the README promise that every change is reversible. File restores do take a fresh backup through `FileStore.write`, so the two paths behave differently.

The same block is also non-atomic. After `reset-recursively`, a `gsettings set` can fail midway, for example when `validateValue` skips an unsupported type and gsettings then rejects it. That leaves the terminal reset to defaults with only some values restored.

Fix:
- In `restore`, call `this.backup()` unconditionally (not `ensureBackup`) and return its ts, so the UI can offer "undo restore".
- Optionally, on a failure inside the apply loop, re-apply the pre-restore snapshot.
- Add a test: change, restore, and assert that a new backup exists holding the changed state.

### M2. rc files are decoded as lossy UTF-8, so any save silently corrupts bytes that are not valid UTF-8, and the diff cannot show it

Code: `apps/term-dashboard/src/files/file-store.ts:177` (`readFile(realPath, 'utf8')`), then the Config-mode render (`shell-service.ts:98-100`) and `writeTemp` (`file-store.ts:353`).

Scenario:
1. `~/.bashrc` contains a Latin-1 comment or a `PS1` with raw high bytes.
2. The user saves an alias in Config mode.
3. Every invalid byte outside the managed block is replaced with U+FFFD (`EF BF BD`) on disk.
4. `previewWrite` diffs the two decoded strings, which are identical for those lines, so the preview shows only the block change.

This breaks "Everything else in the file is kept as is". The backup still holds the original bytes, which is the only thing that keeps this from being High.

Fix: decode with `new TextDecoder('utf-8', { fatal: true })`. For non-UTF-8 files, either refuse Config and raw saves (400 "file is not UTF-8"), or carry a `Buffer` and splice the block at byte level. Add a test with a Latin-1 byte outside the block.

### M3. No flow control on PTY output, so a fast producer grows td's heap without limit and can crash td (killing every terminal)

Code: `apps/term-dashboard/src/pty/pty-session.ts:313-314` and `apps/term-dashboard/src/pty/pty-manager.ts:164-170`.

Every `data` chunk from `script` goes to `socket.send` without checking `bufferedAmount`. Chromium applies WebSocket backpressure from renderer to network to TCP when xterm.js cannot keep up. After that, Node's socket write queue keeps buffering while `child.stdout` keeps flowing.

Scenario: the user runs `yes`, `cat /dev/urandom | base64`, or `cat` on a multi-GB log in the Terminal page. td's RSS climbs until it is OOM-killed. That loses all sessions, and the instance file is left behind.

Input has the same gap in the other direction: `session.write` ignores the return value of `stdin.write`. That is less serious because input is client-rate-limited.

Fix: expose the raw `ws` (`ws.raw.bufferedAmount`). Pause `child.stdout`/`stderr` above a high-water mark (for example 1 MB) and resume on `drain` or when polling shows the buffer is low again. Add a test that pipes a large output to a socket that does not read.

### M4. Concurrent saves to the same file can both pass the mtime check, so one save is silently overwritten

Code: `apps/term-dashboard/src/files/file-store.ts:193-230`.

`write` has no per-file mutual exclusion. Interleaving within one td process (two tabs, a double-clicked Save, or Ghostty save and raw save together):
1. A re-stats (unchanged).
2. A awaits `backup()`.
3. B re-stats, still unchanged because A has not renamed yet.
4. A renames.
5. B backs up A's content and renames over it.

Both requests return 200. A's change is gone from the live file and survives only in a backup.

The mtime check is also weak by nature on kernels with coarse (jiffy) timestamps: two writes in the same tick have equal `mtimeMs`.

Fix:
- Serialise `write`/`restore` per `FileId` with an in-process promise-chain lock covering stat, check, backup and rename.
- Optionally compare size (or a content hash) along with mtime.

The same pattern affects gsettings profile list read-modify-write: `createProfile`, `duplicateProfile` and `deleteProfile` at `gsettings-service.ts:505-575`. Two creates at once each write `[...old, X]` and `[...old, Y]`, which leaves one profile orphaned in dconf. Use a per-kind lock.

### M5. `~/.profile` is checked with `bash -n`, but it is sourced by `/bin/sh` (dash) at graphical login

Code: `apps/term-dashboard/src/files/file-store.ts:65-70` (`profile: 'bash'`).

I verified it: `a=(1 2)`, `f() { :; }; echo <(true)` passes `bash -n` but fails `dash -n` with `Syntax error: "(" unexpected`. Display managers and Xsession scripts (`/etc/X11/Xsession`, LightDM, and some GDM paths) source `~/.profile` with `sh`. So the raw editor or a backup restore can write a `.profile` that td reports as "check passed" but that aborts at login. The usual result is a session without PATH or env, or a login loop.

Fix: check `profile` with `sh -n` (or with both `sh -n` and `bash -n`) and add a dash case to `file-store.spec.ts`.

---

## Low

- **L1. Unbounded `pending` queue before the PTY session exists.** `pty-manager.ts:108,195`. Each message can be up to 64 KB, and the queue has no count or byte cap while `availability()`/`findExecutable` run. Only an authenticated client can fill it. Cap it, for example close with 1008 past 1 MB.
- **L2. Shutdown race in PTY start.** `pty-manager.ts:147-181`. `shuttingDown` is checked only before the awaits in `spawnSession`. A connection that is mid-start during `closeAll()` still spawns a `PtySession` after shutdown began. `--pdeathsig HUP` and the 5 s forced exit mostly cover it, but disowned or `nohup` jobs of that shell survive, which contradicts the README ("ends every terminal it opened, background jobs included"). Re-check `this.shuttingDown` next to the `closed` check at line 155.
- **L3. The second-td handover trusts a recycled pid.** `instance.ts:110-118,134-152`. `isProcessAlive` treats EPERM (pid owned by another user) as alive. If td died by SIGKILL and its pid was reused by another user's process, that user can listen on the recorded port and answer `/api/health` with that pid. The new `td` would then send the dead instance secret (harmless) and open a launch URL pointing at the attacker's page on `127.0.0.1:<port>`, which is a phishing surface. Treat EPERM as not ours, or compare `/proc/<pid>` uid with our uid.
- **L4. No anti-framing headers.** `server/static.ts:65-83` sets no `Content-Security-Policy: frame-ancestors 'none'` or `X-Frame-Options: DENY`. The token lives in sessionStorage and browsers partition third-party storage, so clickjacking is not currently exploitable. This is cheap defence in depth for a page that hosts a shell.
- **L5. Ghostty two-file save can stop half-way.** `ghostty-service.ts:334-366`. All checks run before any write, but the mtime check runs per file inside `files.write`. A 409 on the second file leaves the first one written, and the client gets an error for a save that partly happened. Pre-check both mtimes immediately before the first write, or report partial results.
- **L6. A missing `ohMyZsh` in a zsh Config save deletes an existing omz block.** `libs/term-config/src/shell/model.ts:473` with `renderOmzBlock(undefined)` returns null, and `setOmzBlock` removes the block. A client that omits the field drops `ZSH_THEME`/`plugins`, for example when oh-my-zsh editing is disabled because there are two `source` lines but a block exists. The diff preview shows it, but "absent" should mean "leave unchanged". Treat `undefined` as no change and `{}` or null as remove.
- **L7. `ZDOTDIR` is ignored.** `file-store.ts:149-154`. zsh files always resolve to `$HOME/.zshrc` etc. Users with `ZDOTDIR` set (often from `~/.zshenv`) get edits that zsh never reads, and no warning appears.
- **L8. Preview has side effects.** `file-store.ts:183` calls `resolve(id, true)`, which `mkdir`s missing parents such as `~/.config/ghostty`, even for a preview.
- **L9. Backups are never pruned.** `reserveBackupDir` creates one folder per save forever. That is fine for now; consider documenting it or adding a retention cap.
- **L10. Resize traffic floods the activity history.** Each resize message spawns `stty -F` through the CommandRunner (`pty-session.ts:416-425`), so dragging a window publishes many commands and evicts useful entries from the 500-command activity history. Consider running stty outside the activity bus, or dropping resize events from the history.
- **L11. Check output can echo rc content.** Syntax-check output (`bash -n` prints the offending line) and `gsettings list-recursively` output (Ptyxis `custom-command` and similar) go into the in-memory activity history and, for 500s, into `console.error` (`app.ts:276`, via `failureText`). Only the authenticated user and td's own terminal see it. Noted because rc lines often contain tokens; consider not logging `detail` to stderr.

## Pre-existing (not from this branch)

- `ubuntu/tsconfig.base.json` has `"strict": false` (already in main). The branch only adds path aliases.

## Checked and found sound

- **Guard** (`server/guard.ts`):
  - exact `Host` allowlist, so DNS rebinding gets 403;
  - API Origin is either absent or allowlisted, and `Origin: null` is rejected;
  - WS upgrades need an allowlisted Origin and the token as a subprotocol;
  - `handleProtocols` echoes only `td`, never the token.
  - Guard and router use the same `c.req.path`, so path tricks route to static, not to handlers (probed).
- **Session** (`server/session.ts`): 256-bit secrets, `timingSafeEqual` over SHA-256 digests, single-use codes with a TTL, and the pending-code map is capped at 32.
- **Auth before body**: the guard runs before `bodyLimit` and body parsing. Limits are 16 KB by default and 1 MB on file routes, and the WS `maxPayload` is 64 KB.
- **Binding**: the bind is `127.0.0.1` only, and the e2e test asserts it with `ss`.
- **Root refusal**: td refuses uid 0 before anything else.
- **Instance file**: written atomically, folder 0700 and file 0600. It is read only after an `lstat` check for regular file, owner uid and mode 0600, and the secret format is validated.
- **Process execution** (`ProcessCommandRunner`): argv only with `shell: false`. Timeouts SIGKILL the child, captured output is capped, and activity output is capped per command and in total.
- **PTY**:
  - the shell path is passed via `TD_SHELL` in the environment, never interpolated into the command;
  - `setpriv --pdeathsig HUP`;
  - session-wide SIGHUP then SIGKILL, refusing sid ≤ 1 and td's own sid;
  - at most 4 sessions, counting the ones still starting;
  - resize ints bounded to 1-1000.
- **FileStore**:
  - only allowlisted ids reach it;
  - realpath containment covers symlinked files and parent folders, and a dangling symlink is refused;
  - the temp file is created `wx` 0600 in the target's directory, then chmod to the target mode and fsync;
  - the check runs on the temp file, and 422 leaves the target untouched;
  - backups are created `wx` 0600 in 0700 folders, with `-N` suffix collision handling;
  - backups are read as a Buffer, so their bytes are exact;
  - the rename is atomic;
  - the timestamp and file id are validated before any path join, so there is no traversal.
- **zsh check**: `zsh -n` does not execute `~/.zshenv` (verified).
- **Shell rendering** (`term-config/shell/model.ts`):
  - every value goes through `shQuote`;
  - alias and variable names are regex-restricted, and PATH is rejected as an export;
  - PATH entries reject `:`, CR, LF and NUL;
  - values cannot contain block-marker lines;
  - duplicate or unclosed markers are refused instead of guessed;
  - unknown lines inside a block are kept in `extra` in the same order.
- **Ghostty**:
  - values with CR, LF or NUL are rejected, so a `config-file` line cannot be injected;
  - `config-file` cannot be edited;
  - keys are checked against the installed schema;
  - every file is validated before any is written.
- **gsettings**:
  - profile uuids are regex-checked before they become a dconf path;
  - keys are checked against the parsed schema, and values against type, enum, flags and range;
  - backup and restore validate schema, path and keys before changing anything;
  - defaults are read with `GSETTINGS_BACKEND=memory`.
- **Static files**: decoded, NUL rejected, resolved, and contained within webRoot; `nosniff` is set.
- **Zero runtime dependencies**: `apps/term-dashboard/package.json` has none, so everything is bundled. It stays `private: true`.

## Test gaps worth adding

1. A gsettings restore after an earlier change in the same run creates a new backup (M1).
2. A non-UTF-8 byte outside the managed block survives a Config save (M2).
3. PTY output backpressure with a socket that does not read (M3).
4. Two concurrent `write()` calls on the same id: exactly one succeeds or both are serialised (M4).
5. A dash-incompatible `.profile` is rejected (M5).
6. Launch-code redemption race and argv exposure (H1), once a fix exists.

Status: DONE_WITH_CONCERNS
Summary: The trust boundary (Host/Origin/Bearer/WS subprotocol, argv-only execution, file allowlist, shQuote rendering) holds. One High: the single-use launch code is visible in xdg-open's and the browser's argv, so another local user can redeem it first for the session token and a shell. There are also four data-loss or reliability Mediums: gsettings restore without a fresh backup, lossy UTF-8 rc round-trip, unbounded PTY output buffering, concurrent-save lost updates. A fifth Medium is the `.profile` checked with bash instead of sh.
Concerns/Blockers: H1's severity depends on whether multi-user hosts are in scope. On a strictly single-user machine it drops to Medium.
