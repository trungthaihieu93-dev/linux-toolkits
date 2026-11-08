# Code review: td follow-up fix commits (61270c1..HEAD)

Date: 2026-11-08 (Asia/Saigon). Reviewer: code-reviewer. This was a read-only review: no code was changed, committed or pushed.
Worktree: `/home/tonythai93/Projects/toolkits-wt/term-dashboard`, branch `feat/term-dashboard`, range `61270c1..HEAD` (12 commits, 21 files, +1227/-89).
Inputs: `code-review-261108-td-fixes.md` (the findings being fixed) and `fix-261108-td-fix-review.md` (the fixer's claims, checked here rather than taken on trust).

## What I ran

All runs used temp HOME/XDG dirs and `GSETTINGS_BACKEND=keyfile`. The real HOME was never used, and every process I started has ended.

- **Bundle:** `NX_DAEMON=false bun --bun nx build term-dashboard --skip-nx-cache` (HEAD).
- **Unit tests on Bun:** `run-many -t test -p term-dashboard term-dashboard-web term-config`. term-config 175, web 140, td 223 + 1 skipped. Exit 0.
- **Lint:** 0 errors. The 2 warnings are in `app.spec.ts`, which is outside the range.
- **Formatting:** `format:check --all` exit 0.
- **e2e on Bun:** `nx e2e term-dashboard`, 17/17.
- **e2e on Node** (built bundle, `e2e-node.sh`): Node 26.13, 17/17. Node 22.13.0, 17/17. For 22.13.0 I downloaded the official tarball and checked it against SHASUMS256. The 3 signal cases ran; they were not skipped.
- **listen.spec reverted out of tree** (HEAD spec against the old and new `listen.ts`, `scratchpad/r3/prep-revert.sh`):

  | `listen.ts` | Node 26 | Node 22.13 | Bun 1.4.4 |
  | --- | --- | --- | --- |
  | Old (61270c1) | 4 fail | 4 fail | 1 fails |
  | New (HEAD) | 7/7 pass | 7/7 pass | 6 pass, 1 skipped |

  - I also ran a mutation with the `if (closed)` block removed: 7/7 still pass (see L2).
- **Manual shutdown repro** (`scratchpad/r3/signal-repro.mjs`):
  - Setup: built bundle, launch code redeemed, `/api/activity` held open (200), a `/ws/pty` session open, and `sleep 300 &` typed into it.
  - Every run on Node 26, Node 22.13 and Bun, for each of SIGINT, SIGTERM and SIGHUP:
    - exit codes were 130 / 143 / 129;
    - `instance.json` was removed;
    - the `script` and `zsh` processes below td were all gone 1 s later.
  - Time to exit: about 55 ms on Node 26, about 280 ms on Node 22.13, about 35 ms on Bun.
- **The CI step on Node 22.13 and 26:** I extracted the "td health check and shutdown" step from the YAML. I ran it with `bash --noprofile --norc -eo pipefail`, the way GitHub runs it, against the bundle placed at `td/package` (`scratchpad/r3/run-ci-step.sh`). Both runs exited 0 and printed both `ok:` lines. `bash -n` passes.
- **Timeouts on upgraded and streaming sockets** (`scratchpad/r3/ws-timeout.mjs`): a `net` gate plus `emit('listening')`, with `headersTimeout` 500 ms, `requestTimeout` 1000 ms and a check interval of 100 ms. A WebSocket upgrade and an SSE stream both stayed open for 3.5 s on Node 26, Node 22.13 and Bun. So the newly enabled timeout checker does not kill terminals or the activity stream.
- **Ghostty symlink-pair repro** (`scratchpad/r3/ghostty-alias-repro.mjs`): built bundle on Node (M1).
- **CI diff against `main`:**
  - `release`, `node-compat` and `smoke` parse as identical YAML and are textually unchanged. The diff against `main` contains only insertions: the zsh step and the block after `smoke`.
  - `td-node-compat`'s matrix is `['22.13.0', '24']`.

---

## Critical

None.

## High

None.

## Medium

### M1. A Ghostty save is refused (400) when `config` and `config.ghostty` are one file through a symlink. This is a regression from the real-path lock.

- `ubuntu/apps/term-dashboard/src/files/file-store.ts:300-305` (new duplicate-real-path 400)
- `ubuntu/apps/term-dashboard/src/ghostty/ghostty-service.ts:290-319,346-352` (writes every dirty doc in one `writeMany`)

**Cause.**
- `writeMany` now refuses any save in which two ids resolve to the same real path.
- Ghostty is the only caller that passes more than one id.
- When `~/.config/ghostty/config -> config.ghostty`, both docs hold the same lines, so every key counts as "set in both":
  - `unset` (what the field Reset sends) dirties both docs;
  - `setList` dirties both docs too (it sets the list in the winner and unsets it in the other file);
  - `set` dirties only the winner, so it still works.

**Reproduced** (built td on Node, temp HOME):

```
config 200 files ghostty:true,ghostty-legacy:true conflicts [font-size, window-padding-x in both]
set   -> 200 (written to ghostty-legacy)
unset -> 400 {"error":"a save names the same file twice (through a symlink)"}
```

**Before this range (61270c1)** the same save succeeded:
- `writeLocked` ran every precheck and the second mtime pass before any rename.
- It then renamed both temp files onto the same real path in `GHOSTTY_FILES` order. `config` (legacy, the winner) was written last, so the file ended with the right content.

**Failure scenario.**
- A user symlinked the two Ghostty config names, for example while migrating to `config.ghostty` but keeping older Ghostty versions working.
- Every Reset of a field, and every list edit such as `keybind` or `font-family`, now fails with a 400 toast.
- The only workaround is editing the file by hand. No data is lost.

**The spec now locks this in.** `file-store.spec.ts` asserts 400 for "one save that names two ids aliasing one file". No caller other than Ghostty can produce that save.

**Fix (cause-aligned).**
- Make `GhosttyService` aware of aliasing. When both ids resolve to the same real path, plan against the winner only (`ghostty-legacy`, which Ghostty loads last) and write one file.
- Optionally suppress the "set in both" conflicts for that case.
- Keep the 400 in `writeMany` as a backstop.
- Add a ghostty-service spec with the symlinked pair for `unset` and `setList`.
- A FileStore-only alternative is to collapse aliased items when their contents are equal. That covers `unset` but not `setList`, whose two docs differ, so the service-level fix is the right one.

## Low

### L1. A leading BOM is still dropped when the file is edited in the raw (Monaco) editor, and the review diff cannot show it

- `ubuntu/apps/term-dashboard-web/src/features/monaco/monaco-editors.tsx:89`: `onChange={(v) => onChange?.(v ?? '')}`
- `ubuntu/apps/term-dashboard-web/src/features/shells/shell-page.tsx:424`

**What the backend now does.** `file-store.ts:138` (`ignoreBOM: true`) keeps U+FEFF in `content`, and the spec proves the byte-exact round trip on the server.

**What the editor does** (verified in the installed sources):
- monaco-editor 0.57 `pieceTreeTextBufferBuilder.acceptChunk` splits a leading BOM off when the model is created.
- `TextModel.getValue(eol, preserveBOM = false)` returns the text without it.
- `@monaco-editor/react`'s `onChange` passes `editor.getValue()`.

**Scenario.**
1. `.bashrc` starts with `EF BB BF`.
2. The user changes one line in the raw editor. `raw` no longer has the BOM, so the save writes the file without it.
3. The save-review `DiffEditor` builds both models the same way, so line 1 looks unchanged.

**How the claims hold up.**
- The README line "saving it unchanged writes the same bytes" is literally true: an unchanged file has nothing to save. Config-mode saves also keep the BOM, because the server edits the original content.
- The code comment at `file-store.ts:136-137` ("so a save writes it back instead of silently dropping it") overstates this for the main editing path.

**Fix.** In `CodeEditor`, read `editorRef.current?.getModel()?.getValue(undefined, true)` (preserveBOM) in the change handler instead of the wrapper's `v`. Or narrow the README wording to Config mode.

### L2. The `closed` branch in `listen.ts` is never reached, and the spec named after it does not exercise it

- `ubuntu/apps/term-dashboard/src/server/listen.ts:122-125`
- `listen.spec.ts` "drops a connection whose check completes after close()"

**Why it is never reached.**
- `admit` adds every socket to `sockets` synchronously in the gate's connection callback.
- `close()` destroys every tracked socket synchronously, so a late check returns at `if (socket.destroyed) return;` first.
- `gate.close()` stops new accepts in the same tick.

**Mutation test.** With the block removed, all 7 specs still pass on Node.

**Impact.** No behaviour defect: the late-check guarantee holds through the destroy loop. The spec title just credits the wrong mechanism. Keep the branch as a backstop or drop it, and adjust the comment or spec name so a future refactor does not trust it.

---

## Previous findings: verdicts (code-review-261108-td-fixes.md)

| Finding | Verdict | Evidence |
| --- | --- | --- |
| **H1** Node shutdown hangs with an open tab; instance file left behind | **Fixed** | See "H1 evidence" below the table. |
| **M1** gsettings write after the form unmounts; phantom spec | **Fixed** | See "M1 evidence" below the table. |
| **M2** README claims td never gates the release | **Fixed** (docs option) | README:212-225 matches `ci.yml`: td lint/test/build/e2e (`nx affected` / `run-many -t lint test build e2e`, lines 78/82) and the zsh install (lines 65-68) run in `checks`. `release` needs `[checks, node-compat, smoke]` (line 390). The comment above the td jobs (lines 201-205) was corrected too. |
| **M3** `readOnly` ignored by the web UI | **Fixed** | See "M3 evidence" below the table. |
| **L1** BOM stripped on read | **Fixed on the server**, partial end to end | `ignoreBOM: true`; the spec checks the byte-exact save and the backup. The raw editor still drops it (new **L1**). |
| **L2** locks keyed by id, not real path | **Fixed**, with a new regression | Two-stage locking (id at call time, then sorted real paths); deterministic race spec with 409; 18/18 stress runs per the fixer, and the suite passes here. It introduced **M1** (Ghostty symlink pair refused). |
| **L3** header/request timeouts not enforced on Node | **Fixed on Node**; not on Bun (documented, spec skipped) | 408 spec passes on Node 26 and 22.13. WS and SSE are unaffected by the checker (probe). |
| **L4** late peer check admits a socket after close | **Fixed** | Destroy loop plus `closed` flag; the spec fails on 61270c1. The flag itself is never reached (**L2**). |
| **L5** restore toast hides the pre-restore backup | **Fixed** | `describeGSettingsRestore` is used by both toasts and has a spec. The Backups page reloads its list after a gsettings restore (spec checks 1 then 2 listed). |

**H1 evidence.**
- Socket tracking plus a destroy-all in `close()`. A late peer check is dropped.
- `server.emit('listening')` starts Node's connection tracking. `server.close()` stops the checker.
- HEAD's listen spec fails 4/7 against the old `listen.ts` on Node 26 and 22.13, and passes 7/7 on the new one.
- e2e covers SIGINT, SIGTERM and SIGHUP with the activity stream and the PTY open (2 s bound), on Node 22.13, Node 26 and Bun.
- In the manual repro, exit is prompt, the instance file is removed and nothing is left behind.
- The CI step runs on Node 22.13 and 26.

**M1 evidence.**
- An `unmounted` ref is set in the flush cleanup and reset on mount. `schedule` and `onValidityChange` do nothing once it is set.
- The spec now advances timers by twice `GSETTINGS_WRITE_DELAY_MS`, which is the same method that exposed the phantom.
- StrictMode does not break it. The field reports validity on mount only when invalid, and a field always mounts valid. The simulated unmount flushes an empty pending map.
- A new case checks that a valid waiting value is written exactly once.

**M3 evidence.**
- **Shell page:** note with the reason, Monaco `readOnly`, `onChange` removed, Config tab disabled, forced to Monaco mode, `blocked`, and `review()` guarded.
- **Ghostty page:** note per file, form `disabled` (`SchemaForm` passes it to each field), Save disabled with a reason, `review()` guarded, and a tab badge.
- **Backups page:** a note in the viewer; Restore reads the backup first and refuses with a toast before any preview.
- All three have specs.

---

## Checked and found sound

**`listen.ts` shutdown**
- **`emit('listening')` side effects.**
  - Node's `setupConnectionsTracking` creates the connections list and an unref'd checker interval.
  - `@hono/node-server` 2.1.6 has no `'listening'` listener.
  - `ws` runs with `noServer: true`.
  - `server.close()` now emits `'close'` on the never-listening server. Hono's handler for it calls `wss.close()`, which does not terminate clients in ws 8 and blocks nothing. The sockets are destroyed by the gate loop anyway.
  - On Bun the emit is harmless: all Bun unit, e2e and repro runs pass.
- **Order of cleanup.** `services.close()` (PTYs) runs, then `server.close()`, then `removeInstanceFile` (newest first). `gate.close`'s callback fires once the destroyed sockets have closed.
- **Upgraded WebSocket sockets** stay in `sockets` (same `net.Socket`), so the loop destroys them.

**Two-stage file lock**
- **No deadlock.**
  - A holder of a file lock never waits for an id lock: `writeLocked` does not call `write`/`writeMany`, and `restore` calls `write` without holding a lock.
  - Both stages take keys in sorted order through `KeyedMutex.runAll`, which acquires them one by one.
  - Two saves through different ids aliasing one file, in either order, take distinct id locks and then queue on the one real-path key. The later one gets 409.
  - A save naming one real file twice is refused with 400 before any file lock (that refusal is the cause of M1).
- **Call order for one id holds.** Everything before `idLocks.runAll` is synchronous, so the id lock is queued in the caller's tick.
- **Changes between resolve and the file lock.** The mtime check runs inside the file lock, so a concurrent alias write is detected. Renames go to the real path, so the symlink survives (the spec checks this).

**gsettings number field.** The unmount guard covers the ordering in which the parent cleans up before the child. A field remounted by `reset` deletes `invalid` first, so its unmount report does nothing.

**Restore toast.** The path is rendered as React text (no injection). The no-backup case falls back to "Restored: …".

**terminal-page spec.** `waitFor(sockets.length === 1)` only removes the read-before-effect race. It does not weaken any assertion.

**CI `td-node-compat` step**
- **Valid bash** under `-eo pipefail`.
- **The `kill -0` poll sees td exit.** Bash reaps the background child while it waits for the foreground `sleep`; I confirmed this locally.
- **The trap** kills td and curl only if they are still alive (`|| true`).
- **Failure paths end the step:**
  - an empty or invalid launch code → `curl -f` fails;
  - a missing token → `stdout.write(undefined)` throws;
  - a 401 stream → "did not open".
- **The launch code is read reliably.** It is on the same single `out.write` as the "listening on" line, so `sed` cannot read the log too early.
- **No secret values are printed.** No `set -x`. The code and token are never echoed. curl `-sS` errors show only the URL, and the token is in a header. `td.log` is printed only on the early failure, with `#c=` redacted.
- **The 3 s bound fits.** td exits in about 280 ms on Node 22.13 locally, leaving headroom for GitHub runners.

**Docs**
- README:62-65 (signal exit with tabs open), README:124-126 (symlink alias serialisation; true for concurrent saves, but M1 is not mentioned) and README:212-225 (CI) match the code and `ci.yml`.
- The BOM sentence is literally accurate (see L1).

## Recommended actions

1. **M1:** treat an aliased Ghostty pair as one file in `GhosttyService` and add a spec for `unset`/`setList` with `config -> config.ghostty`.
2. **L1:** read the value with the BOM preserved in `CodeEditor`, or narrow the README wording.
3. **L2:** rename the spec, or drop or document the `closed` branch as a backstop.

## Unresolved questions

- Is the symlinked Ghostty pair a setup td should support (M1), or should the 400 stay and README:124-126 say Ghostty saves refuse it? The behaviour at 61270c1 supported it by accident (last write won).

Status: DONE_WITH_CONCERNS
Summary: All 9 previous findings are fixed. The Node shutdown fix holds on Node 22.13, Node 26 and Bun (manual repro, e2e, reverted spec, and the CI step run locally), and `release`, `node-compat` and `smoke` are unchanged from `main`. One new Medium regression: Ghostty Reset and list edits now fail with 400 when `config` and `config.ghostty` are symlinked to one file.
Concerns/Blockers: M1 is a functional regression introduced by cef0fd5, and its spec locks in the 400. L1 means the BOM fix does not hold for raw-editor edits.
