# Fix report: td follow-up review (code-review-261108-td-fixes.md)

Date: 2026-11-08 (Asia/Saigon). Branch `feat/term-dashboard` (worktree
`/home/tonythai93/Projects/toolkits-wt/term-dashboard`), commits
`010cec8..204471e` on top of `61270c1`. Not pushed.

Status: all 8 items fixed, test-first. Every new spec was run against the
pre-fix code and failed there; it passes now.

## Commits

| Commit | Item |
| --- | --- |
| `010cec8` fix(term-dashboard): shut down on Node while a connection is open | 1 (High) |
| `cca9bf6` ci: check that td stops on Node with a connection open | 2, CI comment for 4 |
| `785207b` fix(term-dashboard-web): send no gsettings write after the form unmounts | 3 |
| `c42f365` fix(term-dashboard): keep a leading UTF-8 BOM when reading a file | 6 |
| `cef0fd5` fix(term-dashboard): lock file saves by the real file, not the file id | 7 |
| `311599b` fix(term-dashboard-web): show files td will not write as read-only | 5 |
| `4a98c9a` fix(term-dashboard-web): name the pre-restore backup after a gsettings restore | 8 |
| `a10c026` docs(term-dashboard): say which td CI jobs gate the release | 4 |
| `50d851d` test(term-dashboard-web): wait for the terminal socket before using it | gate fix (pre-existing flaky spec) |
| `204471e` fix(term-dashboard): keep saves of one file id in call order | follow-up to 7 |

## Per item

1. **Node shutdown hang** (`ubuntu/apps/term-dashboard/src/server/listen.ts`).
   The gate tracks every accepted socket (pending or handed over) and
   `close()` destroys them all. A uid check that completes after `close()`
   destroys the socket instead of handing it over. `server.emit('listening')`
   after `gate.listen` starts Node's connection tracking, so header and request
   timeouts apply to gated sockets (verified: a half-sent request gets 408 on
   Node). `server.close()` in `close()` stops the timeout checker. New optional
   `ListenOptions.http` (headersTimeout/requestTimeout/connectionsCheckingInterval)
   exists so the timeout spec can run fast. Production keeps Node's defaults.
   - Unit (`listen.spec.ts`, 4 new cases). Before the fix on Node, all 4
     failed (close hangs with an idle keep-alive socket and with a streaming
     response, the late check is served, no 408). On Bun only the late-check
     case failed. After the fix: Node 7/7, Bun 6/6 + 1 skipped.
   - e2e (`td.e2e.ts`). The signal test now holds an authenticated
     `/api/activity` stream and a PTY WebSocket open, covers SIGINT, SIGTERM
     and SIGHUP, and requires exit within 2 s with 130/143/129, instance file
     removed and no script/shell processes left. On Node against a bundle built
     from the pre-fix `listen.ts`, all 3 failed with "td still running 2 s after
     SIG…". After the fix: Node 17/17, Bun 17/17.
2. **CI** (`.github/workflows/ci.yml`, `td-node-compat`). The health-check step
   (renamed "td health check and shutdown") now redeems the launch code, opens
   `curl -N` on `/api/activity` with the token, sends SIGTERM, and requires exit
   within 3 s, status 143, and no instance file. I ran the step locally (script
   extracted from the YAML) on Node 26: it passes on the fixed bundle and fails
   on the pre-fix one ("td still running 3 s after SIGTERM with a connection
   open"). Node 22.13/24 are not installed locally, so CI runs those. `release`,
   `node-compat` and `smoke` are identical to `main` (the given `release` diff
   is empty; the job blocks compare equal). The comment above the td jobs no
   longer claims that td never gates the release.
3. **gsettings unmount write** (`gsettings-form.tsx`). An `unmounted` ref is set
   in the flush cleanup (and reset on mount, for StrictMode). `schedule` and
   `onValidityChange` do nothing once it is set. The spec now advances fake
   timers 1 s after `cleanup()`. Before the fix it received
   `PUT {size: '15'}`. A new case checks that a valid waiting value is still
   written exactly once.
4. **README** (`ubuntu/apps/term-dashboard/README.md`). The CI paragraph now
   says plainly that td lint/test/build/e2e and the zsh install run in
   `checks`, which `release` depends on. Only the td packaging, Node-compat
   (now with the shutdown check) and npx smoke jobs are outside the gate. The
   "no byte is ever replaced" claim is replaced with an accurate one (non-UTF-8
   bytes are never rewritten; a leading BOM is kept). The README also covers
   the signal behaviour with tabs open and symlink-alias serialisation.
   AGENTS.md does not repeat the claim, so it is unchanged.
5. **readOnly in the web UI**.
   - Shell page: a note with the reason, Monaco `readOnly`, Config tab
     disabled, saving blocked.
   - Ghostty page: an edit can write either file or move lines between them,
     so any read-only file shows its reason, disables the Settings form and
     Save, and badges the file tab "read-only".
   - Backups page: the viewer shows the reason. `BackupRef` has no `readOnly`,
     so Restore reads the backup first and refuses with an error toast that
     gives the reason, with no preview request.
   - Specs: `shell-page.spec.tsx`, `ghostty-page.spec.tsx`, and the new
     `backups-page.spec.tsx`. Each failed before the fix.
6. **BOM** (`file-store.ts`). The decoder is now
   `{ fatal: true, ignoreBOM: true }`. Spec: a BOM file reads as `﻿…`, and
   a save writes identical bytes (the backup keeps it too). It failed before
   the fix.
7. **Lock by real path** (`file-store.ts`). Saves take the per-id lock at call
   time (which keeps call order), resolve, then take a real-path lock. A real
   path named twice in one save gets a 400. Specs:
   - concurrent saves through `profile` and `bash_profile -> .profile` (a
     runner that holds both syntax checks makes the race deterministic): one
     gets 409;
   - one `writeMany` naming both: 400.

   Both failed before the fix. My first version resolved before taking any
   lock, which lost call order for same-id saves. The existing "serialises
   concurrent writes to one file" spec failed once in 8 full runs. `204471e`
   restores the id stage. After it, 18/18 parallel stress runs passed.
8. **gsettings restore toast**. The new `describeGSettingsRestore`
   (`features/gsettings/gsettings-restore.ts`, with a spec) adds the
   pre-restore backup path as the undo point. Both toasts use it, and the
   Backups page reloads its list after a gsettings restore.

Extra: `terminal-page.spec.tsx` failed in 2 of 3 full web runs, never alone.
The spec read `sockets[0]` before the effect that opens the socket had run.
This race was there before my changes, and it blocked the `bun run test`
gate. `mount()` now waits for the socket (5/5 full runs pass).

## Gates (from `ubuntu/`, `NX_DAEMON=false`)

| Command | Exit | Counts |
| --- | --- | --- |
| `bun run lint` | 0 | |
| `bun run test -- --skip-nx-cache` | 0 | core 53, term-config 175, toolchains 161, linux-toolchain 55, term-dashboard-web 140, term-dashboard 223 + 1 skipped |
| `bun run build -- --skip-nx-cache` | 0 | 3 projects |
| `bun --bun nx run-many -t e2e --skip-nx-cache` | 0 | linux-toolchain 5, term-dashboard 17 |
| `bun run e2e` | 0 | |
| Node e2e (`node …/vitest.mjs run --config apps/term-dashboard/vitest.e2e.config.mts`, Node 26.13) | 0 | 17 |
| `bun run format:check` | 0 | |

## Safety

- Real HOME, dotfiles and dconf were not touched. All runs used temp
  HOME/XDG and `GSETTINGS_BACKEND=keyfile`; the `dconf` CLI was never called.
- `sha256sum ~/.zshrc ~/.bashrc ~/.config/ghostty/config*` and
  `gsettings list-recursively org.gnome.Ptyxis | sha256sum` were taken before
  and after. The two sets are identical.
- Every td, vitest and nx process I started has ended. No `sleep 300` or
  script children were left.

## Concerns

- Under **Bun**, header/request timeouts still do not apply to sockets
  handed over with `emit('connection')`. Bun's `node:http` enforces them only
  for a server that listens itself (probed). The bundle targets Node, where
  they now work. The 408 spec is skipped on Bun, with a comment saying why.
  Shutdown works on both runtimes.
- `apps/term-dashboard/tsconfig.spec.json` has 6 type errors in
  `src/server/routes/routes.spec.ts`. They are not from this work (the same
  count with my changes stashed), and no Nx target typechecks specs, so I left
  them.
- `terminal-page.spec.tsx` is outside this task's findings. I changed it only
  to remove a test race that blocked the test gate.
