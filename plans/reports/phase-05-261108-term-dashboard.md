# Phase 5 report: config pages (Ghostty, Ptyxis/GNOME Terminal, shells, backups)

Date: 2026-11-08 (Asia/Saigon). Branch `feat/td-p5`. Refs #13.

## Built

Web, under `ubuntu/apps/term-dashboard-web/src/`:

- **Save flow** (`features/save/`): `save-review-dialog.tsx` shows a read-only Monaco diff (side by side from 1024 px, inline below), the check output (argv, passed, failed or skipped), the backup location and Apply in the CTA colour. Apply stays disabled while any check fails or nothing would change. `use-save-flow.ts` runs preview, review and apply. A 409 hands over to the app's "File changed on disk" prompt; a 422 or other error stays in the dialog. `preview-text.ts` rebuilds the current text from the preview's diff. `save-bar.tsx` is the sticky "N unsaved changes / Discard / Review and save" bar. `unsaved-changes.tsx` guards in-app navigation, back/forward, and tab close or reload (`beforeunload`), and gives pages the same prompt for mode and file switches. `app/router.tsx` gained a navigation blocker for this.
- **Schema form** (`features/schema-form/`): `schema-field.tsx` has one control per kind: bool (switch), enum (select), range (slider plus number box), number, color (picker swatch plus validated hex), list (add, remove, reorder), multi (searchable checklist), pairs `a(ss)` (key/value rows), tuple `(uu)` (two numbers), theme and font (searchable combobox with a preview chip, typed values optional), and text. Each field shows its summary, expandable Help, a "modified" badge and a reset button. `schema-form.tsx` adds search, grouping and a "Modified only" filter, and windows long lists through `windowed-list.tsx` (variable-height plain windowing; no new dependency).
- **Ghostty** (`features/ghostty/`): not-installed state, a conflict banner, Settings / `config.ghostty` / `config` tabs (each file tab lists its entries and includes read-only), and the schema form over the effective config for all 211 keys. Edits are staged as `set` / `setList` / `unset`, saved through `POST /api/ghostty/preview|save` with both files' mtimes, and followed by a reload note (`ctrl+shift+,`), the backup paths and any server warnings. Repeatable keys list only what the files set, so defaults are never copied into a file. A value that comes only from a theme is not flagged as modified.
- **Ptyxis / GNOME Terminal** (`features/gsettings/`): one `TerminalSettingsPage` keyed by `kind`, with General, Shortcuts and Profiles tabs. `gsettings-form.tsx` writes each key on its own 500 ms after the last edit (pending writes flush on unmount), shows writing/saved/failed, and resets keys. `gsettings-fields.ts` maps GVariant types to controls, and anything without a control is edited as GVariant text. `profiles-panel.tsx` covers create, duplicate, rename (label key), set default, and delete through an AlertDialog that names the profile (disabled for the default). The Ptyxis `palette` key gets a picker; when the list is unavailable it falls back to validated free text. "Restore backup" applies the newest gsettings JSON backup that covers the terminal, after a confirmation.
- **Shells** (`features/shells/`): a bash/zsh page with a file picker and Config ⇄ Monaco modes. Config mode (`.bashrc` / `.zshrc`) has Aliases, Environment, PATH (before and after), History, and for zsh with oh-my-zsh, Theme and Plugins from `GET /api/shells/zsh/oh-my-zsh`. These are disabled, with the server's reason, when the source line is not editable. It also has the "Defined outside td" panel with "Edit in Monaco at line N" links, and `validateShellModel` errors block saving. Monaco mode edits the whole file. Switching modes or files, or navigating away, with unsaved edits asks first.
- **Monaco** (`features/monaco/`): `monaco-setup.ts` runs `loader.config({ monaco })` with the local `monaco-editor/editor/editor.api`, the editor contributions, only the shell language, and only the editor worker (`editor.worker?worker`). `monaco-theme.ts` builds the theme from the CSS tokens (no hex in components). `lazy-editors.tsx` lazy-loads all of it, so the main chunk stays at 372 kB and Monaco (3.9 MB) loads only when an editor or diff opens.
- **Backups** (`features/backups/backups-page.tsx`): file backups grouped by file id, newest first. View opens a read-only Monaco dialog, and Restore goes through SaveReviewDialog and sends the preview's mtime. gsettings backups restore after an AlertDialog.
- `app/routes.tsx`: the `PENDING` map and `pending-page.tsx` are gone, and every page is a lazy chunk.

Server and contract (compatible additions only):

- `GET /api/terminals/:kind/palettes` returns `NameList`: the user's `$XDG_DATA_HOME/org.gnome.Ptyxis/palettes/*.palette` plus the built-ins from `gresource list <ptyxis>` (run through CommandRunner, so it shows in the activity panel). A failed listing contributes nothing, and GNOME Terminal gets 404. Code is in `gsettings/gsettings-service.ts` and `server/routes/gsettings.ts`, with specs in `gsettings-service.spec.ts` and `routes.spec.ts`.
- `SavePreview.backupDir?` (set in `files/preview.ts`) lets the dialog say where the backup goes before writing, and `API_PATHS.terminalPalettes` was added (`api.spec.ts`).

## Checks

| Check | Result |
|---|---|
| `bun --bun nx run-many -t lint test build -p term-dashboard term-dashboard-web term-config --skip-nx-cache` | exit 0. term-config 174 tests, term-dashboard 173 (+2), term-dashboard-web 64 in 16 files. No lint warnings, and no chunk warning after the limit was raised (see Deviations) |
| `bun run lint && bun run test && bun run build && bun run format:check` | exit 0 |
| Required specs | `schema-field.spec.tsx` (12, one per control type plus modified and reset), `shell-page.spec.tsx` (mode switch guard: prompt, Keep editing, Discard, navigation guard, "Edit in Monaco at line N"), and `save-review-dialog.spec.tsx` (Apply disabled on a failed check, on any of several files failing, and when nothing changes; allowed when a check is skipped). Also `ghostty-fields`, `gsettings-fields`, `monaco-theme`, `shell-model`, `focus-return` and `activity-provider` specs |
| Sandbox walkthrough | Built bundle (`node …/main.js --no-open --port 0`) with fresh `mktemp` HOME, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR` and `XDG_CACHE_HOME`, `GSETTINGS_BACKEND=keyfile`, the fixture oh-my-zsh template as `.zshrc` with a fake `$ZSH`, `/etc/skel/.bashrc`, and the synthetic Ghostty fixture. Driven by headless Chrome over CDP with a Node built-ins script |
| Ghostty theme | Catppuccin Mocha changed to Dracula. The diff against the backup is only that line. The backup folder is 0700 and the file 0600 |
| Ptyxis profile | "Work" created and its palette set to `dracula` from the gresource list. The sandbox keyfile has the profile, its label and palette. A gsettings JSON backup was taken |
| zsh Config mode | Alias `gs` added and the oh-my-zsh theme set to `agnoster`. `diff` against the backup shows only the two blocks: the omz block above `source` (line 78) and the main block at the end. The only line outside the markers is the blank separator the block codec inserts before the main block |
| bash Monaco | `export TD_DEMO=1` saved with `bash -n` passing and a backup. Then `if then` was blocked: check "failed", Apply disabled, output `syntax error near unexpected token 'then'`, and Escape closed the dialog |
| Activity panel | 36 commands in the final run, including `ghostty +validate-config` ×3, `gsettings set … label` and `… palette`, `zsh -n` ×2, `bash -n` ×3 and `gresource list` |
| Network | All 272 page requests of the final run (app, Monaco chunk, editor worker, codicon font, API) went to `127.0.0.1`. These were captured with the CDP Network domain on the page; requests made from inside workers were not captured, and the editor worker makes none |
| Terminal (from phase 4) | `tput cols` 147 at 1440 px and 78 at 900 px. Closing the tab ended `script -qfec` (none left after 4 s) |
| Theme (from phase 4) | The toggle wrote `"theme": "light"` to the sandbox `settings.json`. After a td restart, a new tab with empty sessionStorage rendered light |
| Screenshots | `plans/reports/screens-261108-td-phase5/`: ghostty, ptyxis, ptyxis-profiles, zsh, bash and backups at 375 and 1440 in dark and light; the save-review dialog at 375 and 1440 in both themes; the failed-check dialog; zsh Config, bash Monaco, the terminal, and the overview after restart. The raw output is in `checks.txt` |
| Horizontal scroll at 375 | None. Document and `<main>` overflow are 0 on every page in both themes, including the open dialog |
| Keyboard-only | One save per page by keyboard: Ghostty (search, font-size with ArrowUp, Review, Apply), Ptyxis (Profiles tab with arrows, New profile with Enter, a switch with Space), zsh (Add alias, Shift+Tab into the row, Review, Apply), bash (Monaco mode with Enter on the tab, type, Ctrl+M, Tab to Review, Apply) and Backups (Restore). No focused element lacked a visible indicator, focus started inside every dialog, 25 Tabs never left it, and Escape closed it and returned focus to the opener |

## Real-environment safety

Taken before any work and again after everything ran: `sha256sum ~/.zshrc ~/.bashrc ~/.config/ghostty/config ~/.config/ghostty/config.ghostty` plus a read-only `dconf dump /org/gnome/Ptyxis/ | sha256sum`. They are identical (5 of 5 entries). td, headless Chrome and the sandbox folders were stopped or removed. `pgrep -fa 'term-dashboard|script -qfec|vite|headless'` shows only processes that were already running before this phase (a Tomcat JVM and the VS Code Copilot runtime).

## Fixes found by the walkthrough (all committed)

- Code-opened Radix dialogs returned focus to `<body>` because they have no Trigger. `components/ui/focus-return.ts` now restores focus to the opener, or to `<main>` when the opener is gone.
- Buttons were disabled while a request ran and so lost focus. They now use `aria-disabled` plus a guard. Tab panels had `outline-none`; they now show the focus ring.
- `sr-only` text in the activity list could scroll the `overflow-hidden` frame. The frame is now `overflow-clip`, and `<main>` and the list are positioned.
- The shell mode tabs used automatic activation, so focus returning after "Keep editing" reopened the prompt. They now activate manually.
- A page parked in the back/forward cache kept its activity SSE open, and later loads waited about 30 s for a connection (HTTP/1.1 allows six per host). The stream now closes on `pagehide` and reopens on `pageshow`.
- The long gsettings path overflowed at 375 px; it now wraps.

## Deviations

- **One server route added** (palettes) and one optional contract field (`SavePreview.backupDir`). Both are additions only.
- **Field kind `multi`.** It was not in the phase's list. It covers gsettings flags and oh-my-zsh plugins.
- **`build.chunkSizeWarningLimit: 4500`** in `vite.config.mts`, with a comment. The only chunk over 500 kB is the lazily loaded Monaco chunk, whose size the plan accepts. The main chunk is 372 kB.
- **Check argv in the dialog shows the temp path.** The server replaces the temp path in the check output but not in `argv`. This is phase 3 behaviour and was left as is.
- **Commit `9ba3fbe` fails one shell-page spec on its own.** The fix is the next commit, `269380c` (manual tab activation). The branch head passes everything.
- **Harness notes.** Twice, a headless Chrome tab stopped answering CDP after td was restarted under it. The renderer was idle, not busy, a fresh tab always worked, and the problem did not reproduce in targeted tries, so the final run opened a fresh tab after each restart. Monaco 0.57 takes input through `.native-edit-context` (EditContext), not the textarea; the script focuses that element.
- The phase status in `plans/` was not changed. Update it with `ak plan`.

## Unresolved questions

- None blocking. GNOME Terminal is still not installed here, so its pages were exercised only through the shared component and specs.
