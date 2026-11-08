# Fix report: td web UI and CI review findings

Date: 2026-11-08 (Asia/Saigon). Branch `feat/td-fix-web` (from `feat/term-dashboard`), worktree `/home/tonythai93/Projects/toolkits-wt/td-fix-web`. Source: `plans/reports/code-review-261108-td-web-ci-docs.md`. Not pushed, not merged.

## Outcome

All accepted findings (M1-M3, L1-L9) are fixed in 11 focused commits. Every behaviour change has a spec that fails on the previous code and passes now (checked by stashing the source file and re-running the spec). `term-dashboard-web` goes from 15 spec files / 64 tests to 21 / 131.

## Changes by finding

| Finding | Fix | Specs |
| --- | --- | --- |
| M1 gsettings write order | `gsettings-form.tsx`: writes and resets run through one promise queue, so each request starts after the previous response; a response always reflects every earlier change. Complements the server-side per-schema serialization. | `gsettings-form.spec.tsx` (ordering, reset behind a write) |
| M2 number fields | `NumberInput` and the hex box report invalid text (`onValidityChange`) through `SchemaField`/`SchemaForm`. The gsettings form drops the waiting write while a box is invalid and writes the draft once it is valid; nothing is written for an invalid box on unmount. Ghostty and shell pages disable "Review and save" while any field is invalid (`use-invalid-fields.ts`). An invalid number box shows the rule it breaks. Reset/Discard remount the field (`revisions`) so stale text goes even when the value is unchanged. | `schema-field.spec.tsx`, `gsettings-form.spec.tsx`, `ghostty-page.spec.tsx` |
| M3 CI gate | `ci.yml`: td pack + `td-package` artifact moved to a new `td` job; Node 22.13/24 `--version` + health check to `td-node-compat`; npx tarball smoke (ubuntu:24.04, root) to `td-smoke`. `release` still needs only `checks`, `node-compat`, `smoke`; `node-compat` and `smoke` are byte-identical to `main` again. zsh install stays in `checks` (now with `Acquire::Retries=3`). | n/a (see verification) |
| L1 stale mtime after save | Shell page replaces the view from `SaveResult` + reviewed `candidate` at once, then reloads; a reloaded view resets a draft only if it still equals the view it was based on, so Monaco text typed during the reload stays. Ghostty page re-reads the config before dropping staged edits (no flash of old values); if that read fails it keeps the saved mtimes and shows a toast. | `shell-page.spec.tsx`, `ghostty-page.spec.tsx` |
| L2 409 prompt | `api.ts`: `onConflict` fires only for file write routes (`isFileWriteRoute`: Ghostty preview/save, shell config/raw preview/save, backup file preview/restore). Other 409/422 errors are thrown; the profiles panel already toasts the server message. | `api.spec.ts`, `profiles-panel.spec.tsx` (422 delete toast) |
| L3 primary hover | `--primary-hover` token (light `#1d4ed8` 6.70:1, dark `#60a5fa` 7.56:1), button uses `hover:bg-primary-hover`, table row added in `theme.css`. | `theme-contrast.spec.ts` checks every table row against the tokens and the 4.5:1 floor |
| L4 ANSI contrast | xterm `minimumContrastRatio: 4.5`; theme.css comment updated. | `terminal-page.spec.tsx` |
| L5 socket cleanup | Cleanup clears `onopen`/`onmessage`/`onclose` before `term.dispose()`; font-load re-measure skipped once disposed. | `terminal-page.spec.tsx` (unmount order, Reconnect) |
| L6 router history | Entries carry their index in `history.state`; a held back/forward step is undone with `history.go(-delta)` and redone with `history.go(delta)` on confirm. Entries the router did not make (no index) fall back to the old push/replace. | `router.spec.tsx` (back and forward hold keep `history.length` and the forward stack) |
| L7 theme race | A theme picked before `GET /api/settings` answers wins; the late load is ignored. | `theme-toggle.spec.tsx` |
| L8 combobox scroll | Highlighted option is scrolled into view (`block: 'nearest'`). | `schema-field.spec.tsx` |
| L9 Ghostty raw number | `rawNumberKeys` finds number keys whose current text is not a number; they render as a text field with the raw value and an inline error; an edit must be a number to save. | `ghostty-fields.spec.ts`, `ghostty-page.spec.tsx` |

README: `ubuntu/apps/term-dashboard/README.md` "Maintainer notes" paragraph now names the `td`, `td-node-compat` and `td-smoke` jobs and says `release` does not need them (one paragraph, lines 172-177 only).

## Verification

- `cd ubuntu && NX_DAEMON=false bun --bun nx run-many -t lint test build -p term-dashboard-web`: exit 0 (21 files, 131 tests).
- `bun run format:check`: exit 0.
- `nx e2e term-dashboard` (sandboxed HOME, keyfile backend): 15/15 passed; no td process left running.
- Release-job diff against `main`: empty.
- `ci.yml` parses (PyYAML); jobs `checks, node-compat, smoke, td, td-smoke, td-node-compat, release`; `release.needs = [checks, node-compat, smoke]`.
- `bash -n` on every `run:` block in the changed jobs, all ok: checks (Install dependencies, Install zsh, Lint/test/build/e2e affected and all, Check formatting, ShellCheck, Build package, Pack package, Run tarball with npx, Run tarball with bun); td (Install dependencies, Build td package, Pack td package); td-smoke (Run td tarball with npx); td-node-compat (Extract td package, td --version, td health check).

## Notes and coupling

- The zsh apt install remains a step of `checks`, so an apt outage can still fail the gate that `release` needs. It is a standard Ubuntu package and the install now retries; this is the one deliberate td coupling left.
- `ci.yml` is not prettier-clean under the ubuntu config, same as on `main`; it is outside `nx format:check` and the release job must stay byte-identical, so it was not reformatted.
- `actionlint` is not installed here; the new jobs have not run on GitHub yet. The first PR run should confirm `td`, `td-node-compat` and `td-smoke`.
- The client queue (M1) and the parallel server serialization are independent; either alone prevents the stale view, together they also keep server order equal to edit order.
