# Fix report: td backend review findings

Date: 2026-11-08 (Asia/Saigon). Branch `feat/td-fix-be` (from `feat/term-dashboard`), worktree `/home/tonythai93/Projects/toolkits-wt/td-fix-be`. Not pushed, not merged.

Inputs: `plans/reports/code-review-261108-td-backend.md`; web-review items M3/L2 and the CSP note in `plans/reports/code-review-261108-td-web-ci-docs.md`.

## Outcome

Every accepted finding is fixed. Each new spec was run and seen failing before its fix landed, except the pure `/proc/net/tcp` parser spec, which was written together with its module. The gate wiring spec did fail against the old `listen`. Focused commits (`Refs #13`):

| Commit    | Subject                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `bb129b2` | fix(term-dashboard): make file saves atomic and lossless                  |
| `4acc71b` | fix(term-dashboard): make gsettings restores undoable and changes ordered |
| `fa98151` | fix(term-dashboard): bound PTY memory and close start-up races            |
| `e05daab` | fix(term-dashboard): keep launch codes out of process arguments (superseded in part by `faaff3c`) |
| `faaff3c` | fix(term-dashboard): refuse connections from other local users            |

## Verification

| Command (from `ubuntu/`, `NX_DAEMON=false`)                                         | Result                    |
| ----------------------------------------------------------------------------------- | ------------------------- |
| `bun --bun nx run-many -t lint test build -p term-config term-dashboard --skip-nx-cache` | exit 0, 7/7 tasks         |
| `bun --bun nx run term-dashboard:e2e --skip-nx-cache`                                | exit 0, 16/16 e2e tests   |

These results are from the final tree, after the peer-check change.
| `bun run format:check`                                                               | exit 0                    |
| `tsc -p apps/term-dashboard/tsconfig.app.json --noEmit`                              | clean                     |
| `tsc -p apps/term-dashboard-web/tsconfig.app.json --noEmit` (read-only check)        | clean with the new contract |

Unit tests: term-dashboard 217 tests in 26 files, term-config 175 tests in 11 files. No e2e case was skipped (zsh, PTY tools, ss, ghostty and the Ptyxis schema are all present).

Real-system safety: `sha256sum ~/.zshrc ~/.bashrc ~/.config/ghostty/config*` and `gsettings list-recursively org.gnome.Ptyxis | sha256sum` were recorded before and after. The two sets are identical. All tests used a temporary HOME with `GSETTINGS_BACKEND=keyfile`; the `dconf` CLI was never used. No td, script or shell processes were left running.

## Fixes

### High

- **H1: another local user redeeming the launch code.** The design changed after review (coordinator decision). A first version opened the browser on a private 0600 `file://` redirect page. Ubuntu's default snap Firefox cannot read `/run/user/<uid>` or hidden folders under HOME, so that version was replaced by a peer-credential check that makes the cross-user attack impossible regardless of argv.
  - **Gate:** `server/listen.ts` accepts TCP connections on a `net` server with `pauseOnConnect`. For each socket, it looks up the owner of the client end in `/proc/net/tcp` and `/proc/net/tcp6`: the row whose local address is the socket's remote address and port, and whose remote address is td's address and port. The socket is handed to the HTTP server (`emit('connection')`, then `resume()`) only if that uid equals td's uid. Otherwise it is destroyed before any byte is read. This covers HTTP and WebSocket upgrades alike.
  - **Fail closed:** when no row is found, the lookup retries once after 25 ms. If there is still no row, or `/proc` cannot be read, the connection is refused. The check runs once per socket at accept, which serves as the per-socket cache.
  - **Notice:** td prints one stderr line per refused uid (or "owner could not be found"), so a flood cannot fill the terminal.
  - **Module:** `server/peer-uid.ts` is a pure parser plus decision: little-endian or big-endian hex words for IPv4 and IPv6, with IPv4-mapped tcp6 rows unwrapped and addresses canonicalised. A thin reader sits on top.
  - **Browser and handover:** both are back to the plain `http://127.0.0.1:<port>/#c=<code>` passed to `xdg-open`. The launch-page module, its cleanup and its API field were removed.
  - **Kept:**
    - a distinct session token per redemption, valid until the process ends;
    - one stderr line per redemption (`td: launch link used; browser session N started …`, no secret);
    - `--no-open` printing the URL.
  - **Specs:**
    - `server/peer-uid.spec.ts`, on fixture text: matching row, another uid, missing row, tcp6 v4-mapped, a retry, `/proc` unreadable.
    - `server/listen.spec.ts`: a real same-uid connection is served through the real `/proc` lookup. With an injected foreign uid or null, the socket is dropped before the handler runs and `onRefused` gets the uid.
    - `session.spec.ts`, `app.spec.ts` and `cli/start.spec.ts`: per-redemption tokens and the notice line.
    - e2e: against the built bundle, `/proc/net/tcp` attributes the test's own socket to the current uid, and td serves a request on that socket.
  - **Limit:** a real foreign-uid connection cannot be made without root (a user namespace does not change the kernel uid shown in `/proc/net/tcp`), so the refusal decision is tested by injection and by fixtures, not end to end.

### Medium

- **M1: gsettings restore.** `restore` always runs `backup()` first, under the locks, and returns it as `GSettingsRestoreResult.backup` (undo point). A failing step no longer stops the rest. The 422 error lists every failed step in `detail`, and its message names the pre-restore backup ts.
- **M2: non-UTF-8 files.** Files are read as bytes and decoded with a fatal `TextDecoder`. A file that is not UTF-8 is returned with `readOnly: "<path> is not valid UTF-8; td shows it read-only and will not save it …"` (new optional field on `ShellFileView` and `GhosttyFileView`).
  - Every write to such a file is refused with 422 under the file lock.
  - A backup that is not UTF-8 gets `BackupContent.readOnly`, and restoring it is refused with 422.
  - Rollback copies backup bytes exactly.
- **M3: PTY backpressure.** New `pty/output-flow.ts`. After each chunk is sent, if `ws.bufferedAmount` > 1 MB, td pauses `script`'s stdout/stderr and polls every 25 ms until the queue is ≤ 256 KB, then resumes. The route passes `ws.raw.bufferedAmount` (verified that `raw` is the `ws` socket in `@hono/node-server`).
  - Spec: real `yes` through `PtyManager` with a socket that never drains. Output stalls below the high-water mark plus one pipe read, and resumes once the socket is drained.
- **M4: concurrent writes.** New `system/keyed-mutex.ts`.
  - `FileStore.write` and `writeMany` hold per-file locks over the whole sequence: stat, mtime check, UTF-8 check, temp, check, re-stat, backup, rename.
  - td's own writes always move the mtime forward. This was needed because on this kernel a write in the same jiffy kept the old mtime and still let the second save through.
  - gsettings takes one lock per terminal kind around create, duplicate, delete, set default, set and reset. `PUT` and reset routes use the new `setAndView` / `resetAndView`, so each response is the view as of its own write. Restore holds every kind's lock.
  - A per-kind lock is stricter than per-schema. Changes are small and debounced, so ordering matters more than parallelism here.
  - The specs reproduce both races against the old code (two concurrent saves both returning 200; a profile orphaned by concurrent creates).
- **M5: `.profile` check.** `profile` is checked with `sh -n`. Bash files keep `bash -n`, and `CheckResult.argv[0]` reflects which check ran.

### Low

- **Web L2 (server side): deleting the default profile** returns **422** with "the default profile cannot be deleted; make another profile the default first". 409 is now documented as reserved for "file changed on disk" only.
- **L1:** input queued before the PTY starts is capped at 1 MB in total. Past that, the socket closes with 1008 and the queue is dropped.
- **L2:** `spawnSession` re-checks `shuttingDown` after its awaits. A connection that is mid-start during `closeAll()` is closed with 1013 and never spawns.
- **L3:** `isProcessAlive` treats EPERM as not ours. `findRunningInstance` sends `GET /api/health?challenge=<random>` and requires `proof` = HMAC-SHA256(instanceSecret, challenge), compared in constant time, before it trusts the instance or sends the secret. Otherwise the file is stale and a new server starts.
- **L4:** every non-101 response carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.
- **L5:** `FileStore.writeMany` checks mtime, UTF-8 and validate-config for every file, re-stats all of them, then writes. If replacing a later file fails, earlier files are put back from their backup bytes, or removed if they were new. The error says what was put back. The Ghostty save uses it.
- **L6:** in `applyShellModel`, an absent `ohMyZsh` leaves the omz block untouched. `{}`, or `null` in the JSON body (which `parseShellBlockModel` maps to `{}`), removes it.
- **L8:** `FileStore.check` no longer creates folders. When the target folder is missing, the check's temp file goes into a private `mkdtemp` folder that is removed afterwards.
- **L10:** resize `stty` runs at most once per 200 ms. The last size wins, and the first resize after start is not delayed. The calls stay in the activity stream. A failed resize no longer blocks later ones.

## Accepted, not fixed

- **L7 (ZDOTDIR):** a feature gap, not a defect in what td claims to do. To be filed as an issue.
- **L9 (backup pruning):** a feature gap. Backups are small and private. To be filed as an issue.
- **L11 (check output in the activity stream and stderr):** local-only and same-user, and the viewer is reading their own file. The README now says the activity panel can show snippets of rc lines.

## Contract changes the web side can rely on (`libs/term-config/src/api.ts`)

All of these are compatible additions; nothing was renamed or removed.

- Status list: 409 only means "file changed on disk". 422 means the request is valid but cannot be applied: a syntax check failed (`detail` = output), the default profile cannot be deleted, a file or backup is not UTF-8, or a gsettings restore partly failed (`detail` lists the steps).
- `DELETE /api/terminals/:kind/profiles/:uuid` on the default profile returns **422** (was 409). The web client can stop treating this case as a conflict; its generic 409 handler is now correct.
- New `readOnly?: string` on `ShellFileView`, `GhosttyFileView` and `BackupContent`. When set, disable saving or restoring and show the text.
- `GSettingsRestoreResult.backup?: GSettingsBackupRef | null` is the pre-restore backup and can be offered as "undo restore".
- `ShellBlockModel.ohMyZsh` in a save: absent means unchanged, and `{}` or `null` means remove. Note for the web side: `normalizeModel` in `shell-page.tsx` deletes an empty `ohMyZsh`. If the UI ever lets the user clear the omz block, it must send `ohMyZsh: {}` (or `null`) explicitly.
- `Health.proof?` is td-to-td only. `LaunchCodeResponse` is unchanged (`{ code }`).
- Every redemption of a launch code now returns a different token. All of them stay valid until td stops.

## Docs

- `ubuntu/apps/term-dashboard/README.md`:
  - Safety model:
    - connections from other local users are refused by peer uid (`/proc/net/tcp`);
    - the launch code is single-use, valid 60 s, and only useful to the same user;
    - session tokens and the per-redemption stderr line;
    - second-start verification;
    - anti-framing;
    - bounded memory;
    - `sh -n` for `.profile`;
    - serialised saves and the Ghostty rollback;
    - UTF-8-only editing;
    - a backup before every gsettings restore;
    - the activity panel can show rc snippets.
  - Backups: restore takes an undo backup and reports failed keys.
- Root `AGENTS.md`, td sections only:
  - FileStore pipeline (lock, 422 for non-UTF-8, `sh -n`, `writeMany`);
  - session tokens and the peer-uid gate in `listen.ts` / `peer-uid.ts`;
  - PTY flow control and rate-limited resize;
  - invariants: other local users are refused by peer uid and the check fails closed; the launch code is single-use, valid 60 s and only useful to the same user; 409 is reserved for file conflicts.

## Follow-ups and concerns

- **Full CSP (follow-up):** a full Content-Security-Policy needs a `sha256-` hash for the inline pre-paint theme script in the web `index.html`, and that file belongs to the web side. Only `frame-ancestors 'none'` is sent for now.
- **Launch code is still visible in argv:** other local users can still see the code in the process list, and the README says so. It is useless to them because their connections are refused. Processes running as the same uid were never inside the threat model.
- **Linux `/proc` dependency:** the gate needs `/proc/net/tcp`. td targets Linux, and the check fails closed without it, so td would refuse every connection rather than serve unchecked ones.
- **Pre-existing spec type errors:** `tsc -p apps/term-dashboard/tsconfig.spec.json` reports 6 errors in `src/server/routes/routes.spec.ts`. They exist before these changes too (checked on a clean tree), and no Nx target runs that check. Not fixed here.
- **mtime detection limit:** external editors that write within the same mtime tick as td's read remain undetectable by mtime alone. td's own writes are now always detected.

Status: DONE
Summary: All accepted backend findings are fixed. The launch-code exposure is now closed by a fail-closed peer-uid check on every connection (`/proc/net/tcp`) instead of a `file://` page, and the browser opens the plain URL again. lint/test/build, e2e and format:check all exit 0, and the real dotfile and Ptyxis hashes are unchanged.
Concerns/Blockers: The foreign-uid refusal is tested by injection and fixtures only (no root). A full CSP needs a hash for the web inline script. There are 6 pre-existing type errors in routes.spec.ts.
