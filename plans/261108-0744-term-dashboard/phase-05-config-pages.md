---
phase: 5
title: "Config pages: Ghostty, Ptyxis/GNOME, shells"
status: completed
priority: P1
effort: "8h"
dependencies: [3, 4]
---

# Phase 5: Config pages: Ghostty, Ptyxis/GNOME, shells

## Goal
Deliver the three config surfaces with schema-driven forms, Monaco editing for shell files, and one shared review-and-save flow.

## Files to create (under `ubuntu/apps/term-dashboard-web/src/`)
- `features/save/save-review-dialog.tsx`: shared confirmation used by every write. Shows the Monaco diff editor (read-only, side-by-side ≥1024 px, inline below), the check output (`bash -n`, `zsh -n` or `ghostty +validate-config`), the backup location, and Apply (CTA colour) / Cancel. Apply is disabled when the check fails.
- `features/schema-form/`: `schema-field.tsx` renders a control from a descriptor (`bool` → switch, `enum` → select, `range` → slider + number input, `number`, `color` → swatch + hex input with validation, `list` → add/remove/reorder rows, `a(ss)` → key/value table, `(uu)` → two number inputs, `theme` → searchable list with a preview chip, `font` → searchable list, `text`). Each field shows summary/doc in a tooltip or expandable help, a modified-from-default badge and a reset action. `schema-form.tsx` adds search, grouping and a "modified only" filter, and virtualises long lists with plain windowing (no extra dependency) because Ghostty has 629 keys.
- `features/ghostty/ghostty-page.tsx`: not-installed state; file tabs (`config.ghostty`, `config`) with a conflict banner when both set a key; schema form over the effective config; staged edits → SaveReviewDialog → `POST /api/ghostty/save`; a note with Ghostty's reload shortcut after saving.
- `features/gsettings/terminal-settings-page.tsx`: one component for Ptyxis and GNOME Terminal keyed by `kind`. Tabs: General (global schema), Shortcuts, Profiles. Profiles: list with default marker, create, duplicate, rename (label key), set default, delete via `AlertDialog` that names the profile (disabled for the default profile). gsettings changes apply per field immediately after a debounced write (gsettings has no file to diff), each write visible in the activity panel; a "Restore backup" action applies the session's gsettings JSON backup. The Ptyxis profile `palette` key gets a picker listing user palettes from `~/.local/share/org.gnome.Ptyxis/palettes/*.palette` plus the built-in names found with `gresource list` on the Ptyxis binary ([UNVERIFIED]; falls back to validated free text if listing fails).
- `features/shells/shell-page.tsx`: shell picker (bash, zsh; zsh hidden when not installed), file picker for that shell's allowlisted files, mode switch Config ⇄ Monaco.
  - Config mode (`zshrc`/`bashrc` only): sections Aliases, Environment, PATH, History, and for zsh with oh-my-zsh: Theme and Plugins, written to the omz block above the `source` line (disabled with the reason when that line is missing). Theme (from `~/.oh-my-zsh/themes` and `custom/themes` listed by the API) and Plugins (from `plugins/` and `custom/plugins`). A read-only "Defined outside td" panel lists the outside-block summary with line numbers and an "Edit in Monaco at line N" link. Save → preview → SaveReviewDialog.
  - Monaco mode: `@monaco-editor/react` configured with `loader.config({ monaco })` from the local `monaco-editor` package (no CDN), only the editor worker imported via Vite `?worker`, language `shell`, theme mapped to the app tokens (dark/light), unsaved-changes guard on navigation. Save → preview → SaveReviewDialog. Switching modes with unsaved changes prompts first.
- `features/backups/backups-page.tsx`: backups per file id and gsettings JSON backups, with view (Monaco read-only) and restore through SaveReviewDialog.
- Specs: SchemaField per control type, ShellPage mode switch guard, SaveReviewDialog disables Apply on a failed check.

## Server additions (under `ubuntu/apps/term-dashboard/src/`)
- `GET /api/shells/:shell/oh-my-zsh` (themes and plugins lists from `$ZSH` or `~/.oh-my-zsh`).
- Any route gaps found while wiring the pages, each with a spec.

## Tasks & steps
1. SaveReviewDialog and schema-form primitives with specs.
2. Ghostty page against a sandbox that holds a copy of the fixture config.
3. Terminal settings page; verify with the sandboxed keyfile backend (gsettings only) that Ptyxis profile create/duplicate/rename/delete produce the expected keyfile, and that the real `dconf dump /org/gnome/Ptyxis/` (read-only) is unchanged.
4. Shell page in both modes; confirm that a Config-mode save changes only the managed block (`diff` against the backup shows changes only between the markers), and that a Monaco-mode save with a syntax error is blocked.
5. Backups page.
6. Screenshot pass (dark/light, 375/1440) and keyboard-only walkthrough of one save per page.

## Verification
- `bun --bun nx run-many -t lint test build -p term-dashboard term-dashboard-web term-config` exits 0.
- Sandbox walkthrough (temp `HOME`, `XDG_CONFIG_HOME`, `GSETTINGS_BACKEND=keyfile`): change a Ghostty theme, add a Ptyxis profile, add a zsh alias in Config mode, edit `.bashrc` in Monaco; each appears in the activity panel and has a backup; the real `~/.zshrc`, `~/.config/ghostty/*` and `dconf dump /org/gnome/Ptyxis/` are unchanged (checksums before and after).
- Monaco loads with the network tab showing no requests outside `127.0.0.1`.

## Rollback
Remove the feature folders and their routes; phases 1-4 stay functional.
