# Code review: td review-fix commits (f16c7f4..HEAD)

Date: 2026-11-08 (Asia/Saigon). Reviewer: code-reviewer (read-only, no code changed).
Worktree: `/home/tonythai93/Projects/toolkits-wt/term-dashboard`, branch `feat/term-dashboard`, range `f16c7f4..HEAD` (21 commits, 68 files, +4102/-339).
Inputs: `code-review-261108-td-backend.md`, `code-review-261108-td-web-ci-docs.md`; fixer claims in `fix-261108-td-backend-review.md`, `fix-261108-td-web-review.md`.

## What I ran

- `NX_DAEMON=false bun --bun nx run-many -t test -p term-dashboard term-dashboard-web term-config --skip-nx-cache --output-style=static`: exit 0 (26 + 21 + 11 files).
- The built bundle (`main.js`, built 14:19 after HEAD) under **Node 26** and **Bun 1.4.4**, temp HOME/XDG dirs, `GSETTINGS_BACKEND=keyfile`, `--no-open --port 0`. I redeemed the code, called `/api/health`, held `/api/activity` open, then sent SIGINT. I also did a WebSocket upgrade on `/ws/pty` through the gate under Node. Scripts: `/tmp/claude-1000/-home-tonythai93-Projects-toolkits/e2625e7c-40ed-4fe8-ab6b-cc17a8e380bd/scratchpad/shutdown-repro.mjs` and `/tmp/claude-1000/-home-tonythai93-Projects-toolkits/e2625e7c-40ed-4fe8-ab6b-cc17a8e380bd/scratchpad/ws-repro.mjs`. No td process was left running.
- A minimal `net` gate + `http.createServer` + `emit('connection')` probe under Node and Bun: `/tmp/claude-1000/-home-tonythai93-Projects-toolkits/e2625e7c-40ed-4fe8-ab6b-cc17a8e380bd/scratchpad/close-test.mjs`.
- An out-of-tree vitest probe against `GSettingsForm`: `/tmp/claude-1000/-home-tonythai93-Projects-toolkits/e2625e7c-40ed-4fe8-ab6b-cc17a8e380bd/scratchpad/webprobe/`.
- The release-job diff from the task (empty), plus the same diff for `node-compat` and `smoke` (identical apart from the new comment block between jobs).
- I did not revert each fix to watch its spec fail; I judged each spec by reading it. The one spec I tested empirically turned out to be a phantom (M1 below).

---

## High

### H1. On Node, td does not shut down while a browser tab is open, and the instance file is left behind (regression from the peer-uid gate)

- `ubuntu/apps/term-dashboard/src/server/listen.ts:227-231,257,278-283`
- `ubuntu/apps/term-dashboard/src/server/cleanup.ts:25-36`
- `ubuntu/apps/term-dashboard/src/main.ts:40-45`

Cause:
- The HTTP server never calls `listen()`; the gate `net` server does, and it hands over sockets with `server.emit('connection')`.
- In Node, the http server's connection tracking (`setupConnectionsTracking`: the connections list and the headers/request-timeout checker) is installed on the server's own `'listening'` event. That event never fires here, so `server.closeAllConnections()` is a no-op.
- `gate.close()` waits until every socket it accepted has ended, including the handed-over ones.

Reproduced:
- `close-test.mjs`: on Node, `close()` with one idle keep-alive socket does not resolve within 3 s. On Bun it resolves in 0 ms.
- `shutdown-repro.mjs`, built td on Node:
  - With `/api/activity` open (the dashboard always holds this SSE stream), SIGINT prints `td: SIGINT, shutting down` and td is **still running 12 s later**.
  - Only a second SIGINT ends it (`forceExit(130)`), and `$XDG_RUNTIME_DIR/term-dashboard/instance.json` is left behind.
  - Without the stream, exit takes about 6 s (the 5 s keep-alive timeout).
  - On Bun it exits in 3 ms.

Failure scenario:
1. The user presses Ctrl+C, closes the terminal (SIGHUP), or a session manager sends SIGTERM.
2. `cleanups.runAll()` is sequential, newest first. `services.close()` ends the PTYs, then `server.close()` never resolves.
3. `removeInstanceFile` and the `main.ts` grace timer never run, because that timer is armed only after `run()` resolves.
4. td stays alive, and the open connection can still be used for API calls (rc writes, gsettings) after the user asked td to stop.
5. On SIGHUP or SIGTERM there is no second signal, so td lingers until the tab closes.

This contradicts README lines 63-64 and the new safety-model advice to "stop td with Ctrl+C if you see" an unexpected session (README:85-87).

Why CI does not catch it:
- Unit tests and `bun run e2e` run on Bun.
- `td-node-compat` sends SIGTERM only after `curl` has closed its connection.
- `listen.spec.ts` would likely hang in `afterEach` under Node (its first case uses keep-alive `fetch`).

Fix:
- Track handed-over sockets in `listen` (a `Set<Socket>`, deleted on `'close'`). In `close()`, destroy them all, and also destroy sockets still waiting for their peer lookup. Or call `server.closeIdleConnections()` and destroy the rest.
- Alternatively, call `server.emit('listening')` once after `gate.listen`. That initialises Node's tracking, so `closeAllConnections` and the header/request timeouts work, but it relies on a Node internal.
- Add a Node-run check: CI `td-node-compat` should keep a connection open, for example `curl -N` on `/api/activity` with a redeemed token or a plain keep-alive socket, then SIGTERM and assert exit 143 within a few seconds.

---

## Medium

### M1. Web M2 is not fixed when a gsettings form unmounts: the last valid number is written although the box shows something else, and the spec that claims otherwise is a phantom

- `ubuntu/apps/term-dashboard-web/src/features/gsettings/gsettings-form.tsx:162-168` (flush on unmount), `:172-181` (`onValidityChange`)
- `ubuntu/apps/term-dashboard-web/src/features/schema-form/schema-field.tsx:99-105` (an unmounting control reports "valid")
- Spec: `gsettings-form.spec.tsx:190-196`

Sequence (passive-effect cleanups run parent before child on unmount):
1. The user types `15` and then `150` on a key with max 100. `15` becomes the draft, and `150` marks the key invalid and cancels its timer.
2. The user navigates away (or switches profile).
3. The form's flush runs first and finds nothing pending.
4. The child's cleanup then reports `false`, so `onValidityChange` deletes the key from `invalid` and calls `schedule(key, drafts[key])`. That arms a new 500 ms timer that no cleanup will ever clear.
5. Result: `PUT {key: 'size', value: '15'}` after the page is gone.

Verified with the out-of-tree probe: the same steps as the spec plus `advanceTimersByTime(1000)` give `[{ key: 'size', value: '15' }]`. The shipped spec asserts `calls` right after `cleanup()` without advancing timers, so it cannot see the write.

Fix:
- Keep an `unmounted` ref set in the flush cleanup, and make `schedule` and `onValidityChange` no-ops once it is set.
- Or make `onValidityChange(key, false)` schedule only when the field is still mounted.
- Advance timers in the spec.

### M2. Web M3 is only partly fixed: td's lint, test, build and e2e still run in `checks`, which `release` needs, and the README says the opposite

- `.github/workflows/ci.yml:78,82` (`nx affected` / `run-many -t lint test build e2e` include term-dashboard, term-dashboard-web and term-config), `:62-68` (zsh apt install)
- `ubuntu/apps/term-dashboard/README.md:207-211`: "CI tests td in the `checks` job … The `release` job does not need the td jobs, so a td failure never holds back a `linux-toolchain` publish."

What happened:
- The pack, Node-compat and npx smoke steps moved out of the gate, and the release job is byte-identical to `main` (verified).
- But a failing td unit test, a flaky td e2e, or an apt outage on the zsh install still fails `checks` and blocks the publish. The web fix report mentions the zsh coupling; the README hides the test coupling.

Fix (pick one):
- Exclude td projects from `checks` (`--exclude=term-dashboard,term-dashboard-web,term-config`, where term-config is td-only) and run them in the `td` job. Move the zsh install with them.
- Or keep the coupling and correct the README sentence (and AGENTS.md if it says the same) to "a td packaging/runtime failure never holds back a publish; td tests still run in `checks`."

### M3. The new `readOnly` contract is not used by the web UI, so a non-UTF-8 file can be edited and then fails at save time

- Backend: `files/file-store.ts:226,303-305,458-460`; `ShellFileView.readOnly`, `GhosttyFileView.readOnly`, `BackupContent.readOnly` (`libs/term-config/src/api.ts`).
- Web: `readOnly` is not read in `features/shells/shell-page.tsx`, `features/ghostty/ghostty-page.tsx` or `features/backups/backups-page.tsx`. Its only hit there (`backups-page.tsx:104`) is the Monaco prop.

Failure scenario:
1. `.bashrc` has a Latin-1 byte.
2. The page shows the file decoded with U+FFFD. The Save bar, review and preview work.
3. The save then returns 422, and the user loses the edit session's work without having been told up front.

Data integrity holds (the server refuses), so this is UX and contract drift, not data loss. The backend fix report lists the field as something "the web side can rely on", but the web branch never took it up.

Fix: when `view.readOnly` or `backup.readOnly` is set, show the text as a banner, set Monaco `readOnly`, and disable the Save bar, Config mode and Restore.

---

## Low

- **L1. The fatal decoder strips a UTF-8 BOM, a new silent byte change.** `file-store.ts:129` uses `new TextDecoder('utf-8', { fatal: true })`, and `ignoreBOM` defaults to false, so a leading `EF BB BF` is dropped from `content`. Any save then writes the file without it. The old `readFile(...,'utf8')` kept it as U+FEFF (verified on Node and Bun). This breaks "no byte is ever replaced" (README:122-124), and the diff preview cannot show it. Fix: `{ fatal: true, ignoreBOM: true }`, plus a spec.
- **L2. File locks are keyed by `FileId`, not by the resolved path.** `file-store.ts:279` (`locks.runAll(ids, …)`). Symlinked aliases inside HOME, for example `~/.bash_profile -> .profile` or `~/.zprofile -> .profile`, resolve to the same `realPath` under different ids. Concurrent saves of the two ids then interleave as backend M4 did: both pass the mtime check and one is lost (it survives only in a backup). Fix: resolve first, then lock on `realPath` (a second lock stage after `resolve`).
- **L3. Header and request timeouts are not enforced on Node**, from the same root cause as H1 (no `'listening'` event, so no `checkConnections` interval). A same-uid client can hold half-sent requests open indefinitely. Only the same user can reach the server now, so this is low; the `emit('listening')` or socket-tracking fix in H1 covers it.
- **L4. Sockets still waiting for their lookup at `close()` are admitted afterwards.** `listen.ts:250-258`: after `close()`, a lookup that resolves still runs `server.emit('connection')`. Fix: a `closing` flag checked next to `socket.destroyed`.
- **L5. The pre-restore "undo" backup is not shown in the UI.** `GSettingsRestoreResult.backup` is returned (`gsettings-service.ts:917`), but both restore toasts (`terminal-settings-page.tsx:92-96`, `backups-page.tsx:160-164`) show only `restored`. The backup does appear in the Backups list, so this is discoverability only.

Informational, not defects:
- Session tokens grow by one per redemption (`session.ts:104-105`), and `isSessionToken` is O(n) SHA-256 work. Redemption needs a minted code, and codes are minted only at start or by a same-uid second `td` holding the instance secret, so growth is user-driven. Not a DoS vector now that other uids are refused.
- `/proc/net/tcp` is read in full for every connection. On hosts with very large socket tables this adds latency per connection; it is acceptable for a local tool.

---

## Original findings: verdicts

### Backend review

| Finding | Verdict | Evidence / caveat |
| --- | --- | --- |
| H1 launch code in argv leads to the token | **Fixed** (by design change) | Fail-closed peer-uid gate (`listen.ts`, `peer-uid.ts`); per-redemption tokens and a stderr notice. The code is still in argv but is useless to other uids. Introduces new **H1** (Node shutdown hang). |
| M1 gsettings restore without a fresh backup | Fixed | `restoreLocked` always calls `backup()` first under every kind's lock, continues past failed steps, returns `backup`. |
| M2 lossy UTF-8 round trip | Fixed (with caveat) | Fatal decode; `readOnly`; 422 on write/restore; byte-exact rollback. Caveat: BOM stripping (**L1**); the web ignores `readOnly` (**M3**). |
| M3 PTY output unbounded | Fixed | `output-flow.ts` pauses at 1 MB and resumes at or below 256 KB by polling; disposed on exit/close. Session exit is detected on `'exit'`, so a paused session cannot block teardown. |
| M4 concurrent saves / profile-list RMW | Fixed (per id) | `KeyedMutex` over the whole write sequence; per-kind gsettings lock; mtime always advanced. Symlink aliases are not covered (**L2**). |
| M5 `.profile` checked with bash | Fixed | `CHECKS.profile = 'sh'`. |
| L1 unbounded pre-start queue | Fixed | 1 MB cap, then close with 1008. |
| L2 shutdown race in PTY start | Fixed | `shuttingDown` re-checked after the awaits (1013). |
| L3 recycled pid / port takeover | Fixed | EPERM counts as not alive; HMAC challenge proof before the secret is sent. |
| L4 anti-framing | Fixed | XFO DENY + `frame-ancestors 'none'` on non-101 responses; the middleware runs before the guard, so 403s get the headers too. |
| L5 Ghostty two-file half save | Fixed | `writeMany`: every precheck before any rename, a second mtime pass, rollback from backup bytes or unlink. |
| L6 absent `ohMyZsh` deletes the block | Fixed | `applyShellModel` returns early when `ohMyZsh === undefined`; `null` maps to `{}` (remove). The web `normalizeModel` still never sends an empty object; the current UI cannot clear omz fields, so nothing changes in behaviour. |
| L7 ZDOTDIR | Not fixed (accepted) | Feature gap, to be filed as an issue. |
| L8 preview creates folders | Fixed | `check()` uses a private `mkdtemp` when the parent is missing. |
| L9 backup pruning | Not fixed (accepted) | Feature gap. |
| L10 resize floods activity | Fixed | 200 ms rate limit, last size wins, a failure does not block later resizes. |
| L11 check output echoes rc | Not fixed (accepted, documented) | README:129-133. |

### Web/CI/docs review

| Finding | Verdict | Evidence / caveat |
| --- | --- | --- |
| M1 gsettings write order | Fixed | A client promise queue (`.catch` per task, so a rejection cannot stall the chain; the tasks are async, so there is no synchronous throw) plus server `setAndView` under the kind lock. |
| M2 number box writes a value it does not show | **Partially** | The live path is fixed. The unmount path still writes the last valid value, and its spec is a phantom (**M1**). |
| M3 td steps gate the release | **Partially** | Pack, Node-compat and smoke moved out; release/node-compat/smoke are byte-identical to `main`. td lint/test/e2e and the zsh install still sit in `checks`, and the README claims otherwise (**M2**). |
| L1 stale mtime after save | Fixed | The shell page replaces the view from `SaveResult` + candidate; Ghostty re-reads first and falls back to `withSavedMtimes`. |
| L2 any 409 opens the file prompt | Fixed | `isFileWriteRoute` (regexes match `API_PATHS`); the server now returns 422 for the default-profile delete; the only `conflict(` left is in `file-store.ts:529`. |
| L3 primary hover contrast | Fixed | `--primary-hover` token plus a contrast spec over the table. |
| L4 ANSI contrast | Fixed | `minimumContrastRatio: 4.5`. |
| L5 socket writes after dispose | Fixed | `onopen`/`onmessage`/`onclose` are nulled; font re-measure is guarded. |
| L6 router rewrites history | Fixed | Index in `history.state`, `history.go(±delta)`. The router mounts after the launch-code `replaceState(null)`, so the index is not wiped. |
| L7 theme load undoes a toggle | Fixed | `chosen` ref. |
| L8 combobox scroll | Fixed | `scrollIntoView({block:'nearest'})`. |
| L9 Ghostty raw number shows 0 | Fixed | `rawNumberKeys` renders it as text with an inline error. |
| Note: CSP | Partially (by design) | Only `frame-ancestors`; a full CSP needs a hash for the inline script (follow-up). |

---

## Checked and found sound

- **`/proc/net/tcp{,6}` parsing** (`peer-uid.ts`):
  - field indexes (local=1, rem=2, uid=7) match the kernel format;
  - addresses decode per 32-bit word in host byte order, so on little-endian `0100007F` → `127.0.0.1`;
  - ports are host order;
  - the v4-mapped check uses bytes 10-11 = `ff ff` after word reversal;
  - canonical comparison on both sides;
  - malformed rows are skipped.
  - The state column is not checked. This cannot be turned into a bypass: TIME_WAIT/orphan rows report uid 0 or the original owner, td never runs as uid 0, and a LISTEN row has remote `0:0`, which never equals td's endpoint. The worst case is a false refusal.
- **Bypass analysis.** The row's uid is the creator's `sk_uid` (it is not changed by fd passing to other processes). The 4-tuple is unique while td's accepted end exists. td's own accepted row has local = server, so it can only match if client == server, which needs binding td's listening port (EADDRINUSE; `SO_REUSEPORT` requires the same uid). Root-owned forwarders show uid 0, which is refused. sshd forwarding for another user runs as that user, which is refused. I found no way for another uid to be admitted.
- **Fail closed.** No row, unreadable `/proc`, a lookup that throws, or a missing address/port all give `null`, which is refused. `isPeerAllowed` requires `uid !== null && uid === own`. One retry after 25 ms.
- **Handover.** With `pauseOnConnect` nothing is read before the decision. After `emit('connection')` plus `resume()`, every byte reaches the parser: under Node, a keep-alive GET, an SSE stream and a WS upgrade (`101`, protocol `td`, PTY output frames) all worked through the gate. The temporary `'error'` swallow is removed before the handover, and the http server installs its own. `void admit()` cannot reject: `peerUid` is wrapped, and `onRefused` only writes to a stream.
- **KeyedMutex.** It releases in `finally`; the tail only ever resolves, so a failing task does not poison the chain; `runAll` takes locks in sorted order. No re-entrant use: `restoreLocked` calls `backup()`, which takes no lock, and `*AndView` call `view()` unlocked.
- **PTY backpressure.** `ws.raw.bufferedAmount` drives pause/resume. The polling timer is disposed on exit and on socket close, and exit is detected on `'exit'`, so a paused stdout cannot hang teardown. A pause after the socket closed is harmless because the session is killed.
- **gsettings restore.** The pre-backup failure aborts before any change; `backupDone` stays consistent; every step is recorded and a 422 lists them.
- **Ghostty two-file save.** All mtime/UTF-8/syntax checks run first, then a second mtime pass, then renames with rollback (backup bytes through a temp file and rename, or unlink when the file was new).
- **Web promise queue, invalid-field tracking** (except the unmount path), **router guard**, theme race, terminal cleanup.
- **CI:**
  - `release` is byte-identical to `main` (empty diff with the given command), and so are `node-compat` and `smoke`;
  - the new jobs use the same action versions as `main`;
  - `td-smoke` runs `npx` in `ubuntu:24.04` as root with only `--version/--help` (td refuses root for the server);
  - `td-node-compat` health-checks through the gate on Node 22.13 and 24, redacts `#c=` on failure, and checks `wait` = 143.
- **Docs.** The README safety model matches the code for the peer check, session tokens, launch code, second start, framing, bounded memory, `sh -n`, serialised saves (per id) and the gsettings pre-restore backup. Exceptions: "Ctrl+C stops td" (H1), "no byte is ever replaced" (L1) and the CI paragraph (M2). The AGENTS.md td sections match the code, apart from the README's CI claim, which AGENTS.md does not repeat.

## Recommended actions (priority order)

1. H1: close handed-over sockets in `listen.close()` (or initialise Node's connection tracking), and add a Node-run shutdown check with an open connection in `td-node-compat`.
2. M1: stop scheduling gsettings writes after unmount; fix the phantom spec to advance timers.
3. M2: move td projects out of `checks` or correct the README CI paragraph.
4. M3: use `readOnly` in the shell, Ghostty and backups pages.
5. L1 (BOM), L2 (lock by realPath), L4 (closing flag); L3 is covered by item 1.

## Unresolved questions

- Should `checks` keep td's tests (one workspace, shared libs) at the cost of release coupling? This is the maintainer's call (M2).
- Run the unit/e2e suites under Node too? Bun hid H1 for every Node user, and the published bundle targets Node.

Status: DONE_WITH_CONCERNS
Summary: Most original findings are fixed and the peer-uid gate is sound against cross-user bypass. But the gate introduced a High regression: on Node (the published runtime), td does not shut down on SIGINT/SIGTERM/SIGHUP while a dashboard tab is open, and it leaves the instance file behind. Web M2 (unmount write) and CI M3 are only partly fixed.
Concerns/Blockers: H1 is reproducible with the built bundle under Node and invisible under Bun-only test runs. Per-fix "spec fails without the fix" claims were checked by reading, not by reverting; the one I tested empirically (gsettings unmount) is a phantom.
