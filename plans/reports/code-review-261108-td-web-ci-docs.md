# Code review: td web UI, CI and docs (feat/term-dashboard)

Date: 2026-11-08 (Asia/Saigon). Reviewer scope: `ubuntu/apps/term-dashboard-web/**`, `.github/workflows/ci.yml`, td docs (`ubuntu/apps/term-dashboard/README.md`, `AGENTS.md`, `README.md`, `ubuntu/README.md`), `ubuntu/apps/term-dashboard/project.json` build wiring. Diff `main...HEAD`. This was a read-only review: no code was changed.

## Summary

There are no Critical or High findings. Session and token handling, XSS sinks, Monaco/xterm loading and the CI `release` job are sound. The real defects are a write-ordering race and a number-input mismatch on the gsettings form, both of which can write or show a different value than the user intended. CI also has a coupling problem: td steps now sit in the `release` job's dependency chain. Everything found is new in this branch. Nothing is pre-existing in `main`.

## Critical

None.

## High

None.

## Medium

### M1. gsettings writes can return out of order, so the form shows stale values and later list edits undo earlier ones
- `ubuntu/apps/term-dashboard-web/src/features/gsettings/gsettings-form.tsx:79-94`. Each PUT response calls `setView(next)` with the whole schema view, whatever order the responses arrive in. The server does not serialize writes either (`apps/term-dashboard/src/gsettings/gsettings-service.ts:399-416` runs `gsettings set` and then a fresh `list-recursively`, with no lock).
- Failure scenario: the user edits key A, then key B more than 500 ms later while A's request is still running (each request spawns 2 or 3 `gsettings` processes). If B's response arrives first, B's draft is cleared. A's response arrives next, but it holds a view read before B was set, so `setView` puts the old value of B back on screen. The status line says "saved", yet the form shows the old B. If B is a list or pairs key (`as`, `a(ss)`), the user's next edit of B starts from the stale list. That write then silently undoes the earlier B change, a lost update.
- Fix: give every write a sequence number and apply a response only if it is newer than the last one applied (`const seq = ++seqRef.current; ... if (seq < appliedRef.current) return; appliedRef.current = seq; setView(next)`). Alternatively, queue the writes through one promise chain, or merge only the written key from the response. The same applies to `reset()` (lines 133-153).

### M2. A number box shows invalid text but keeps (and writes) the last valid value
- `ubuntu/apps/term-dashboard-web/src/features/schema-form/schema-field.tsx:61-110` (`NumberInput`). `onChange` sends only valid numbers upward, while the box keeps whatever text was typed.
- Failure scenario (gsettings, which saves on its own after 500 ms): on a key with max 100, typing `150` passes through `15`, which is valid and gets scheduled. Then `150` is invalid and is ignored. `gsettings-form.tsx:111-122` writes `15` to dconf while the box shows `150` with only an `aria-invalid` outline. Clearing the box works the same way: the old value stays in the model and gets written. On Ghostty and shell pages the review diff shows the real value, which limits the damage, but Save still stays enabled while a field is visibly invalid. A related case: after Discard, an invalid box keeps its stale text when the reset value equals the last valid one, because the `[value]` effect does not run.
- Fix: report the invalid state upward (for example `onValidityChange(id, false)`). Block the debounced write in `GSettingsForm.schedule` and disable SaveBar while any field is invalid. Alternatively, reset the text to `String(value)` on blur when it is invalid.

### M3. td CI steps now gate the linux-toolchain release
- `.github/workflows/ci.yml`. The `release` job itself is byte-identical to `main` (verified with `diff`), but it still `needs: [checks, node-compat, smoke]`. Those jobs now contain td-only steps: `apt-get install zsh` (checks), "Build/Pack td package" (checks), the td health check (node-compat) and `npx` of the td tarball (smoke).
- Failure scenario: an apt mirror failure, a slow runner hitting the 10 s `listening on` wait, or any td regression makes `node-compat` or `smoke` fail. A merged version bump of `linux-toolchain` is then not published until someone re-runs the workflow or fixes td. That contradicts "td is not part of the release job" in AGENTS.md and the td README.
- Fix: move the td steps into their own `td` job (and `td-node-compat`, if needed) that `release` does not list in `needs`. Alternatively, accept the coupling on purpose and say so in AGENTS.md. Retrying `apt-get` (`-o Acquire::Retries=3`) would also reduce flakiness.

## Low

### L1. After a save, the page keeps the old `mtimeMs` until the reload finishes
- `features/shells/shell-page.tsx:180-189`, `:125-130`; `features/ghostty/ghostty-page.tsx:159-173`. After a successful save the page calls `reload()` and keeps the old `view` (old `mtimeMs`) until the refetch returns.
- If the refetch fails, the next save sends the old `baseMtimeMs` and gets 409. The user then sees "File changed on disk" for a change td made itself. Text typed in Monaco during the reload window is replaced without warning when the new view arrives. On the Ghostty page the form briefly shows the old values, because `staged` is cleared before `config` updates.
- Fix: update the local view from `SaveResult` (`mtimeMs`, plus `candidate` from the reviewed preview) right away, and skip the draft reset when the draft differs from what was saved.

### L2. Any 409 opens the app-wide "File changed on disk" prompt
- `src/lib/api.ts:111`, `src/app.tsx:102-129`. The server also returns 409 for `the default profile cannot be deleted` (`gsettings-service.ts:568`).
- If the default profile changed elsewhere (for example in Ptyxis itself), deleting that profile shows a dialog about a file changing on disk, plus the toast. Fix: call `onConflict` only for file-write routes, or have the server send a distinct error code.

### L3. Primary button hover is below 4.5:1
- `src/components/ui/button.tsx:11` `hover:bg-primary/90`: 4.45:1 in dark mode (`#0b0f14` on `#3677df`) and 4.37:1 in light mode (`#fff` on `#3a72ed`), computed. Destructive and CTA hovers pass. Fix: add a `--primary-hover` token, or darken the primary in light mode and lighten it in dark mode on hover.

### L4. The terminal ANSI palette has low-contrast entries
- `src/styles/theme.css` (light): `--ansi-bright-white #9ca3af` is 2.54:1 and `--ansi-bright-yellow #ca8a04` is 2.94:1 on `#ffffff`. Dark `--ansi-bright-black #64748b` is 4.04:1. The comment excuses these as chosen by programs, but `ls` and prompt colours use them all the time. Fix: set `minimumContrastRatio: 4.5` in the xterm `Terminal` options (`features/terminal/terminal-page.tsx:91`).

### L5. The old WebSocket keeps writing into a disposed terminal
- `features/terminal/terminal-page.tsx:177-186`. Cleanup nulls `onclose` but not `onmessage`. Frames already queued after `ws.close()` (on Reconnect or unmount) call `term.write` on a disposed `Terminal` and `setSession` for the old session. Fix: set `ws.onmessage = null` (and `onopen`) in cleanup, or guard with a `disposed` flag.

### L6. Holding a back/forward navigation rewrites browser history
- `src/app/router.tsx:49-60`. When the guard holds a Back press, `pushState(current)` cuts off the forward entries. Proceeding then calls `replaceState(target)`, which leaves a duplicate entry. Forward navigation that gets held loses the forward stack. Fix: remember the index (`history.state`) and use `history.go(delta)` to restore, or accept and document this.

### L7. The theme load can undo a quick toggle
- `src/lib/theme.ts:70-85`. If the user toggles before `GET /api/settings` resolves, the late response puts the old theme back on screen while the PUT has already saved the new one. Fix: ignore the load result once `setTheme` has run (a `userChanged` ref).

### L8. The combobox highlight can scroll out of view
- `features/schema-form/searchable-list.tsx:71-84, 150-165`. Arrow keys move `aria-activedescendant` inside a `max-h-48` scrolling listbox without calling `scrollIntoView`, so keyboard users lose sight of the highlighted option. Fix: `document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })` in an effect.

### L9. A Ghostty number key with non-numeric text shows `0`
- `features/ghostty/ghostty-fields.ts:97-102` maps any non-numeric file value to `0`. This is only a display problem unless the user edits the field, but `0` can be a meaningful value. Fix: fall back to the `text` kind when the current value does not parse.

### Note (backend scope, defence in depth)
The server sends no CSP. If one is added, the pre-paint inline script in `index.html` needs a `sha256-` hash.

## Test gaps
None of these have specs: `terminal-page.tsx` (socket lifecycle), `gsettings-form.tsx` (debounce, flush on unmount, ordering), `profiles-panel.tsx`, `backups-page.tsx`, `router.tsx` blocker, `unsaved-changes.tsx`. M1, M2 and L5 would have been caught by focused specs.

## Checked and found sound
- **Launch code and token.** `readLaunchCode` validates the format. The fragment is cleared with `replaceState` before the POST. The code is redeemed once per page load (module-level promise, StrictMode-safe). The token is kept only in sessionStorage and sent as a Bearer header; the activity stream goes through `fetch` with headers, so the token is never in a URL. The PTY subprotocol token is base64url (`server/session.ts:30`), which is valid as a subprotocol. `<meta name="referrer" content="no-referrer">` is set. No `console.*` logging of secrets.
- **XSS.** There is no `dangerouslySetInnerHTML` or `innerHTML`. File content, diffs, check output, command output and schema docs all render as React text or in Monaco. The font preview `style.fontFamily` only sets that one property. The only `href` values are the in-app `Link` and `#main`.
- **No external requests.** In the built bundle (`dist/apps/term-dashboard-web`), Monaco comes from the local package with `loader.config({ monaco })`. The `cdn.jsdelivr.net` string is the loader's default config, which this overrides, so it is never fetched. The editor worker is bundled, Monaco links are off, fonts come from fontsource and the codicon font from local assets. No other hosts are fetched (the rest are licence and namespace strings).
- **Leaks.** The activity stream aborts on unmount and on pagehide, and reconnects on a bfcache pageshow; its backoff stops on 401 and 404. xterm, FitAddon, ResizeObserver and the socket are disposed in cleanup. Monaco models are disposed by `@monaco-editor/react` (no `path` or `keepCurrentModel`).
- **Save flow.** The dialog cannot close while busy. A 409 closes it and hands over to the conflict prompt. Apply sends the same body that was previewed, so the server's mtime check protects against changes made in between. Rebuilding the original from the reverse patch falls back to the raw diff when it fails.
- **Unsaved-changes guard.** It covers in-app navigation, back/forward, mode and file switches, and `beforeunload`. Route keys (`ShellPage key=bash/zsh`, `TerminalSettingsPage key=kind`) prevent state carrying over between pages.
- **gvariant mapping.** It uses `formatGVariant` and `parseGVariant` from term-config, applies integer ranges per type, handles `ms` (empty means null), and falls back to raw GVariant text for unknown types, which the server validates.
- **Theme tokens.** The theme.css contrast table was spot-checked (muted-foreground 7.10/6.24/7.75/6.09, primary 5.23/5.17) and matches. Dark is the default with a pre-paint cache. Disabled `opacity-50` is exempt.
- **CI.** The `release` job is byte-identical to `main`. The td tarball is packed into `$RUNNER_TEMP/td-package/`, a separate artifact, and `private: true` is asserted before packing. `npm pack` works on private packages. No APIs newer than Node 22.13 are used in the td, term-config or core sources. `env … node … &` makes `$pid` the node process, so the `143` check is valid. As root, `--version` and `--help` return before the root check (`cli/start.ts:77`). The launch code is redacted in the failure log.
- **Build wiring.** Nx graph: `term-dashboard -> term-dashboard-web (implicit), term-config`, and `term-dashboard-web -> term-config -> core`, so `^production` inputs cover lib changes. `build` depends on `bundle` and `^build`, then copies the web output into `web/`. `files` in package.json includes `web`.
- **Docs.** Every command checked exists: `dev:td`, `link:td`, `unlink:td`, `e2e` (`ubuntu/package.json`), and `nx test term-config`, `term-dashboard`, `term-dashboard-web` plus `nx e2e term-dashboard` (Nx targets present). The flags `--port`, `--no-open`, `-v/--version` and `-h/--help`, the exit codes 0/1/2/129/130/143, and the hidden `--dev-origin` match `src/cli/program.ts`. `bun link` putting a link in `~/.bun/bin` matches existing links on this machine.
- **Tests.** `bun --bun nx test term-dashboard-web`: 15 files, 64 tests passed.

Status: DONE_WITH_CONCERNS
Summary: No Critical or High defects in the web UI, CI or docs. Three Medium issues (gsettings write-order race, a number input that writes a different value than it shows, td CI steps gating the linux-toolchain release) and nine Low issues should be fixed or accepted before merge.
Concerns/Blockers: The CI changes have never run on GitHub (per the phase-06 report). The first PR run should confirm the zsh install, the `td-package` artifact and the health check on Node 22.13.
