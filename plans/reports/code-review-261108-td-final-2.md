# Code review: td final review fixes (072f8347..HEAD)

Date: 2026-11-08 (Asia/Saigon). Branch `feat/term-dashboard`, worktree
`/home/tonythai93/Projects/toolkits-wt/term-dashboard`. Read-only review.

Commits: `4450c72` (M1), `9ad990f` (L1), `4c86ae8` (L2), `deac818` (plan docs).

## Verdicts

| Finding | Verdict |
| ------- | ------- |
| M1 symlinked Ghostty pair | Fixed. Verified with a temp-HOME probe against the real FileStore, in both symlink directions and with both paths linked to a third file |
| L1 raw-editor BOM | Fixed. Matches how `@monaco-editor/react` 4.7.0 actually syncs `value` |
| L2 `listen.ts` closed flag | Removing it is safe. Shutdown behaviour is unchanged (Node e2e 17/17, listen spec 7/7 three runs on Node) |

## Findings

### Critical / High / Medium

None.

### Low (informational, no fix required)

1. **Raw editor: a BOM cannot be removed, and a U+FEFF typed at offset 0 is moved out of the editor text.**
   `ubuntu/apps/term-dashboard-web/src/features/monaco/monaco-editors.tsx:88-98`.
   - Scenario A: the file has a BOM and the user wants to drop it. Monaco never shows the BOM, and `onChange` always adds it back, so the raw editor cannot remove it.
   - Scenario B: in a file without a BOM, the user pastes U+FEFF at position 0. On the next render `bom` becomes non-empty and `value.slice(1)` is passed in. That differs from the model text, so the library replaces the whole model with `executeEdits`. The invisible character leaves the editor text and is kept as a BOM in the saved value. This also adds one undo stop and moves the cursor.

   Both outcomes match the README promise ("keeps a leading byte order mark"), and scenario B needs a deliberately typed invisible character. No action unless removing a BOM becomes a requirement.
2. **Hard-linked pair not detected (not a regression).** `ubuntu/apps/term-dashboard/src/ghostty/ghostty-service.ts:137-143`.
   `editable()` compares `realPath`, so two hard links to one inode are still treated as two files. A save renames over one path, which breaks the link. This was the behaviour before the range too. Ghostty users do not normally set up a hard-linked pair. If it ever matters, compare `dev`/`ino` instead.

No new defect found in the range.

## What I checked

### M1 (`api.ts:378-382`, `ghostty-service.ts:132-143, 231-252, 266-289, 303-348`, web `ghostty-fields.ts:91-106`, `ghostty-page.tsx:71-81`)
- Code paths: `editable()` returns `['ghostty-legacy']` only when both snapshots exist and their `realPath`s are equal. `config()` builds conflicts from those ids only and marks the other id with `sameFileAs`. `plan()` limits `setters`, `changed` and therefore preview/save/writeMany to those ids. FileStore writes `realPath` with tmp+rename (`file-store.ts:323-365`), so a symlink path stays a symlink. FileStore's duplicate-real-path 400 (`file-store.ts:301-305`) is now a backstop that the pair can no longer reach.
- Web: `fileValues` skips the `sameFileAs` file. `config.ghostty` comes first in load order, so the values that remain are `config`'s. Every form consumer (`ghosttyFormState`, `scalarText`, `rawNumberKeys`, `stageChange`, `stageReset`) goes through `fileValues`, so repeatable keys are not doubled. `baseMtimes` still sends both ids, and the server checks only the written id. After a save the page reloads the config (`ghostty-page.tsx:204-218`). `withSavedMtimes` (the fallback when that reload fails) updates only the written id, which is the only one checked.
- Probe: script `/tmp/claude-1000/-home-tonythai93-Projects-toolkits/e2625e7c-40ed-4fe8-ab6b-cc17a8e380bd/scratchpad/rv/m1-probe.ts`, run with bun on the source. It uses a temp sandbox HOME/XDG with `GSETTINGS_BACKEND=keyfile` and the real FileStore. Ghostty is stubbed and returns an empty `+show-config`, so the override warnings in the output come from the stub. Each scenario ran set, setList (keybind), unset, then set of a new key:
  - `config.ghostty -> config` (reverse direction): no conflicts, `sameFileAs` on `ghostty`, every save writes `["ghostty-legacy"]` once, no "both"/"moved" notices, symlink kept, content correct, keybind not doubled.
  - Both paths linked to a third file `real.conf` in HOME: same result, both symlinks kept.
  - Only `config.ghostty`: writes `ghostty`, no `sameFileAs`. Only `config`: writes `ghostty-legacy`. Both unchanged.
  - Two regular files with different content: font-size conflict shown, "set in both" notice, setList writes both files with the "moved" notice. Same as before the range.
  - `config` linked to a file outside HOME: `config()` returns 400 "resolves to ... outside ...; td does not edit it". Still refused.
  - The fixer's spec covers `config -> config.ghostty` (view, set, unset, setList, preview).
- I did not drive the HTTP API with the built bundle, because session/CSRF setup was not needed to exercise this logic. The bundle was built and used for the Node e2e run.

### L1 (`monaco-editors.tsx:83-98`, `monaco-editors.spec.tsx`)
- Read the installed `@monaco-editor/react` 4.7.0. When `value !== editor.getValue()` it applies the value with `executeEdits` (with `preventTriggerChangeEvent` set). `onChange` receives `editor.getValue()`, and Monaco's text buffer strips the leading BOM. So the approach holds: Monaco gets the value without the BOM, `onChange` adds it back, and the next render's prop equals the model text, so no literal U+FEFF edit happens. Read-only mode uses `setValue` with the stripped text, which is fine.
- Files without a BOM: `bom === ''`, so value and onChange pass through unchanged. The spec's stand-in models the library rule faithfully and asserts both cases. It is not a phantom test.

### L2 (`listen.ts:100-163`)
- A socket is added to `sockets` synchronously in `admit`, before the `peerUid` await. `close()` synchronously destroys every tracked socket and closes the gate, so `socket.destroyed` is already true when a late peer answer arrives. No socket can be accepted after `gate.close()`. The removed `closed` branch could not be reached.
- `e2e-node.sh` (Node 26.13.0): 17/17. `listen.spec.ts` on Node: 7/7, three times.

### README (`apps/term-dashboard/README.md:124-135`)
- The pair sentence matches the code: one write, through the `config` path, and no conflicts. The BOM sentence matches the form path (the decoder keeps U+FEFF, `file-store.ts:136-139`) and the raw editor path.

### Gates (from `ubuntu/`, `NX_DAEMON=false`)
- `run-many -t test -p term-dashboard,term-dashboard-web,term-config --skip-nx-cache`: term-config 175, term-dashboard-web 144, term-dashboard 228 passed + 1 skipped.
- `nx build term-dashboard --skip-nx-cache`: ok.
- Lint for the 3 projects: 0 errors. `format:check`: ok.
- No process I started is still running. All probes used temp sandboxes, which were removed afterwards.

Status: DONE
Summary: M1, L1 and L2 are fixed with no regressions. The symlinked Ghostty pair saves once and keeps its symlink in both directions; the other edge cases behave as before. There are two informational Low notes and no new defects.
