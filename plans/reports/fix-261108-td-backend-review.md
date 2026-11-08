# Fix report: td backend review findings

Date: 2026-11-08 (Asia/Saigon). Branch `feat/td-fix-be` (from `feat/term-dashboard`), worktree `/home/tonythai93/Projects/toolkits-wt/td-fix-be`. Not pushed, not merged.

Inputs: `plans/reports/code-review-261108-td-backend.md`; web-review items M3/L2 and the CSP note in `plans/reports/code-review-261108-td-web-ci-docs.md`.

## Outcome

Every accepted finding is fixed test-first: each new spec was run and seen failing before its fix landed. Four focused commits (`Refs #13`):

| Commit    | Subject                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `bb129b2` | fix(term-dashboard): make file saves atomic and lossless                  |
| `4acc71b` | fix(term-dashboard): make gsettings restores undoable and changes ordered |
| `fa98151` | fix(term-dashboard): bound PTY memory and close start-up races            |
| `e05daab` | fix(term-dashboard): keep launch codes out of process arguments           |

## Verification

| Command (from `ubuntu/`, `NX_DAEMON=false`)                                         | Result                    |
| ----------------------------------------------------------------------------------- | ------------------------- |
| `bun --bun nx run-many -t lint test build -p term-config term-dashboard --skip-nx-cache` | exit 0, 7/7 tasks         |
| `bun --bun nx run term-dashboard:e2e --skip-nx-cache`                                | exit 0, 16/16 e2e tests   |
| `bun run format:check`                                                               | exit 0                    |
| `tsc -p apps/term-dashboard/tsconfig.app.json --noEmit`                              | clean                     |
| `tsc -p apps/term-dashboard-web/tsconfig.app.json --noEmit` (read-only check)        | clean with the new contract |

Unit tests: term-dashboard 210 tests in 25 files, term-config 175 tests in 11 files. No e2e case was skipped (zsh, PTY tools, ss, ghostty and the Ptyxis schema are all present).

Real-system safety: `sha256sum ~/.zshrc ~/.bashrc ~/.config/ghostty/config*` and `gsettings list-recursively org.gnome.Ptyxis | sha256sum` were recorded before and after. The two sets are identical. All tests used a temporary HOME with `GSETTINGS_BACKEND=keyfile`; the `dconf` CLI was never used. No td, script or shell processes were left running.

## Fixes

### High

- **H1: launch code in argv.** The browser is opened on `file://` + a 0600 page `launch-<128-bit hex>.html` in the 0700 folder next to the instance file. That folder is `$XDG_RUNTIME_DIR/term-dashboard/`, or `~/.local/state/term-dashboard/` when `XDG_RUNTIME_DIR` is missing. The page redirects with a meta refresh and `location.replace` to `http://127.0.0.1:<port>/#c=<code>`. It is deleted when its code is redeemed, when the code expires (60 s timer), and on shutdown.
  - Second-instance handover: the running instance writes the page (`POST /api/launch-code` body `{"page":true}` → `{code, page}`). The second td opens it only after checking that the path is a page name in its own page folder and a regular 0600 file it owns.
  - If the page cannot be written, td does not fall back to argv. It prints "not opening a browser…; open the URL above yourself".
  - Each redemption issues a distinct token. Any issued token authorises, and all tokens die with the process.
  - Each redemption prints one stderr line: `td: launch link used; browser session N started (if that was not you, stop td with Ctrl+C)`. The line contains no secret.
  - `--no-open` and a missing display still print the URL to stdout.
  - Specs: `server/launch-page.spec.ts`, `session.spec.ts`, `app.spec.ts`, `cli/start.spec.ts`. A new e2e case puts a recording `xdg-open` on PATH and asserts that its argv never contains the code, that the page and folder modes are right, and that the page is deleted after redemption.

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
- `Health.proof?`, `LaunchCodeRequest { page?: boolean }` and `LaunchCodeResponse.page?` are td-to-td only.
- Every redemption of a launch code now returns a different token. All of them stay valid until td stops.

## Docs

- `ubuntu/apps/term-dashboard/README.md`:
  - Usage section: the launch page.
  - Safety model:
    - session tokens and the per-redemption stderr line;
    - no secrets in argv;
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
  - session and launch-page modules;
  - PTY flow control and rate-limited resize;
  - invariants: no tokens or codes in argv, and 409 reserved for file conflicts.

## Follow-ups and concerns

- **Full CSP (follow-up):** a full Content-Security-Policy needs a `sha256-` hash for the inline pre-paint theme script in the web `index.html`, and that file belongs to the web side. Only `frame-ancestors 'none'` is sent for now.
- **Sandboxed browsers:** Ubuntu's default Firefox is a snap, and snap confinement may refuse `file:///run/user/<uid>/…` and hidden folders under `~` (the same issue Jupyter's redirect file has). In that case the browser shows an access error, and the user must open the printed URL. The README says so. This was not tested against a real snap Firefox: no browser was launched, and the e2e test uses a recording `xdg-open`.
- **Pre-existing spec type errors:** `tsc -p apps/term-dashboard/tsconfig.spec.json` reports 6 errors in `src/server/routes/routes.spec.ts`. They exist before these changes too (checked on a clean tree), and no Nx target runs that check. Not fixed here.
- **mtime detection limit:** external editors that write within the same mtime tick as td's read remain undetectable by mtime alone. td's own writes are now always detected.

Status: DONE
Summary: All accepted backend findings (H1, M1-M5, web L2, L1-L6, L8, L10) are fixed test-first in four commits. lint/test/build, e2e and format:check all exit 0, and the real dotfile and Ptyxis hashes are unchanged.
Concerns/Blockers: Snap-confined browsers may refuse the private file:// launch page (the URL is still printed); a full CSP needs a hash for the web inline script; 6 pre-existing type errors in routes.spec.ts.
