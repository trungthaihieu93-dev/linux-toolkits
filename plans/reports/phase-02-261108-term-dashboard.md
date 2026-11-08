# Phase 2 report: term-config lib

Status: done. Branch `feat/td-p2`.

## Commits
- `66a92b8` feat(term-config): add API contract types (api.ts alone, for the web UI to cherry-pick).
- `78ec543` feat(term-config): add config parsers, codecs and validators.

## What landed (`ubuntu/libs/term-config/src/`)
- `api.ts`: every route's request/response types, the shared constants
  `FILE_IDS`, `SHELL_FILE_IDS`, `ACTIVITY_LIMITS`, `PTY_LIMITS`, `PTY_SUBPROTOCOL`,
  and an `API_PATHS` route table so server and web build the same paths.
- `gvariant.ts`: parse and format for `b y n q i u d s o g`, arrays, tuples and
  maybes (`ms` is in the Ptyxis schema). Typed prefixes (`uint32 129`, `@as []`)
  are accepted. `ay`, `v`, dicts, 64-bit ints and nested maybes are rejected.
  `canonicalGVariant` compares values that print differently.
- `gschema.ts`: XML scanning (no dependency) with enums/flags resolved across
  files, plus `buildSchemaView(schema, values, defaults)`, which produces `GSettingsSchemaView`.
- `gsettings-list.ts`: `list-recursively` parser and a byte-exact formatter.
- `ghostty/parse.ts`, `ghostty/serialize.ts`, `ghostty/schema.ts`: the line model,
  `setValue`/`setList`/`unset`, includes, `findConflicts`, and the docs schema
  with control inference.
- `shell/managed-block.ts`, `shell/model.ts`, `shell/outside.ts`: both blocks,
  `renderBlock`/`parseBlock`, `renderOmzBlock`/`parseOmzBlock`,
  `applyShellModel`, `readShellModel`, `analyzeShellFile` (the parsed part of
  `ShellFileView`) and the outside summary.
- `validate.ts`: validators for file ids, shells, terminal kinds, backup timestamps (with a
  calendar check, plus `formatBackupTimestamp`), profile uuids per terminal,
  schema ids, gsettings keys and Ghostty keys.

## Verification
- `bun --bun nx run-many -t lint test build -p term-config` exits 0 (term-config has
  no build target). `bun run lint && bun run test && bun run build && bun run format:check` exit 0.
  `tsc --noEmit` is clean for the lib and spec tsconfigs. 172 tests pass, and the zsh tests ran because zsh 5.9 is installed.
- The Ptyxis gschema yields 89 keys (27 + 22 + 40), and all 12 enum keys resolve.
- With a stub `$ZSH/oh-my-zsh.sh`, the omz block lands directly above `source $ZSH/oh-my-zsh.sh`, and sourcing
  the result prints `theme=agnoster plugins=git,docker`. Without the block it prints the template's `robbyrussell`/`git`.
- Hostile alias and export values (`'`, `"`, `$()`, backticks, newlines, `;`) pass `bash -n` and `zsh -n`.
  Sourcing them in a temp `HOME` sets exactly the input values and runs nothing.

## Deviations and notes for the next phases
- **Ghostty: 629 key lines, 211 distinct keys.** The dump has 629 key lines in
  total (`palette` appears 256 times, `command-palette-entry` 91 and `keybind` 74).
  The schema returns 211 keys, each with all its default lines in `defaults`. The spec
  asserts both numbers. The plan's "629 keys" means lines.
- Controls inferred from the dump: 52 bool, 38 enum, 19 number, 15 color, 5 font,
  1 theme and 81 text. Flag lists whose default is outside the bullet list
  (`bell-features`) stay text. "Units can be repeated" in duration docs does not
  make a key repeatable.
- The bash history mapping writes `ignoreDups` as
  `HISTCONTROL=ignoredups` / `unset HISTCONTROL`, and `share` as `shopt -s/-u histappend`.
  zsh writes `setopt`/`unsetopt HIST_IGNORE_DUPS` and `SHARE_HISTORY`, plus `SAVEHIST` for the file size.
- Exports named `PATH` are rejected because PATH has its own section. PATH entries that start with
  `~/` render as `"$HOME"'/…'`, so they expand when the file is sourced.
- `applyShellModel` removes the main block when the model is empty and removes
  the omz block when `ohMyZsh` has nothing to set. An omz block found elsewhere is
  moved back above the source line.
- The phase file status was not edited, because `plans/` is outside this phase's file
  ownership. The orchestrator should update it with `ak plan`.

## Unresolved questions
- None blocking. Phase 3 should confirm the GNOME Terminal schema ids in
  `GSettingsTerminalSchemas` from the real XML when it is available.
