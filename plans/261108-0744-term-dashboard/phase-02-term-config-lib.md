---
phase: 2
title: "term-config lib: parsers, codecs, API contract"
status: pending
priority: P1
effort: "6h"
dependencies: [1]
---

# Phase 2: term-config lib: parsers, codecs, API contract

## Goal
Provide pure, fully tested functions that turn every config format td touches into typed models and back without losing content, plus the API types shared by server and web.

## Files to create (under `ubuntu/libs/term-config/src/`)
- `api.ts`: request/response types for every route (written first so phase 4 can start): `Health`, `Settings`, `TerminalInventory`, `GSettingsSchemaView` (keys with `type`, `enum`/`range`, `summary`, `description`, `value`, `default`, `isDefault`), `GhosttySchema`, `GhosttyFileView` (per file: path, exists, entries; effective values; conflicts), `ShellFileView` (path, content, mtime, managed model, outside-block summary), `SavePreview` (unified diff, check result), `ActivityEvent` (`started | output | exited`, id, argv, stream, chunk, code, durationMs, ts), `PtyClientMessage`/`PtyServerMessage`.
- `ghostty/parse.ts`, `ghostty/serialize.ts`: line model `{ kind: 'comment' | 'blank' | 'entry', key, value, raw }` that keeps order, comments, `config-file` includes and repeated keys (`keybind`, `palette`, `font-family`). `setValue`, `setList`, `unset` edit the model in place; serialize returns the original text when nothing changed.
- `ghostty/schema.ts`: parse `ghostty +show-config --default --docs` into `{ key, doc, default, repeatable, control }` where `control` is inferred: `bool` (default `true`/`false`), `number`, `color` (`#rrggbb` default or doc mentions color), `enum` (when the doc lists allowed values in the standard "Valid values" form), `theme`, `font`, else `text`. Repeatable = key appears more than once in defaults or the doc says it can be repeated.
- `gvariant.ts`: parse and format GVariant text for the types the schemas use (`b`, `i`, `u`, `d`, `s`, `as`, `a(ss)`, `(uu)`, `ay` reject, typed prefixes like `uint32 129`, `@as []`). Formatting quotes strings with GVariant escaping so the output is a single argv element for `gsettings set` (never passed through a shell).
- `gschema.ts`: parse `*.gschema.xml` and `*.enums.xml` text (plain string scanning of the small, regular gschema format; no XML dependency) into `{ schemaId, path?, keys: { name, type, enum?, range?, choices?, summary, description, default } }`. Metadata comes from these files (read-only, no processes); Ptyxis' XML defines 89 keys. Defaults shown in the UI come from `GSETTINGS_BACKEND=memory gsettings list-recursively` instead of the XML, because vendor overrides such as Ubuntu's `10_ptyxis.gschema.override` change them.
- `gsettings-list.ts`: parse `gsettings list-recursively` output (`schema key value` per line) into a key to GVariant-text map.
- `shell/managed-block.ts`: find, parse and replace named blocks in the marker style of `libs/core/src/shell.ts` (imported through `@linux-toolchain/core/shell`, never the core barrel): the main block `# >>> term-dashboard >>>` … `# <<< term-dashboard <<<`, inserted at the end of the file when missing; and, for zsh with oh-my-zsh, a second block `# >>> term-dashboard-omz >>>` … `# <<< term-dashboard-omz <<<` that must sit immediately before the `source $ZSH/oh-my-zsh.sh` line, because oh-my-zsh reads `ZSH_THEME` and `plugins` only while that line runs (template lines 11, 76, 78). When the `source` line is missing or appears more than once, theme and plugin editing is disabled with that reason. Duplicate or unclosed markers return an error instead of guessing.
- `shell/model.ts`: `ShellBlockModel` `{ aliases: {name, command}[], exports: {name, value}[], path: { prepend: string[], append: string[] }, history: { size?, fileSize?, ignoreDups?, share? }, ohMyZsh?: { theme?, plugins?: string[] } }`. `ohMyZsh` renders only into the omz block, whose assignments override the template's earlier `ZSH_THEME=`/`plugins=` lines. `renderBlock(model, shell)` produces bash- or zsh-specific text (zsh: `setopt`, `HISTSIZE/SAVEHIST`; bash: `HISTSIZE/HISTFILESIZE`, `HISTCONTROL`, `shopt -s histappend`) with every value through `shQuote` from `@linux-toolchain/core/shell`; `parseBlock(text)` reads back only what `renderBlock` writes (round-trip), and reports unknown lines inside the block as `extra` that are preserved verbatim.
- `shell/outside.ts`: read-only summary of lines outside the block (alias, export, `ZSH_THEME=`, `plugins=(...)`, `source` lines) with line numbers, shown in Config mode so users see what the managed block overrides.
- `validate.ts`: validators for client-supplied identifiers: file ids (allowlist), backup timestamps (`^\d{8}T\d{6}Z(-\d+)?$`), profile uuids (32 hex for Ptyxis, RFC 4122 for GNOME Terminal), schema ids (from the inventory), key names (from the parsed schema), shell names.
- `index.ts` exports.
- Fixtures in `src/__fixtures__/`, captured from this machine: `ghostty-show-config-docs.txt` (full output), `ghostty-config.ghostty`, `org.gnome.Ptyxis.gschema.xml` (and its enums file if separate), `ptyxis-list-recursively.txt`, `zshrc-ohmyzsh.txt` (a copy of the oh-my-zsh template, not the user's personal file), `bashrc-ubuntu.txt` (`/etc/skel/.bashrc`).

## Tasks & steps (test-first)
1. Write `api.ts` and commit it before the rest so phase 4 can build against it.
2. For each module, write the spec first: round-trip (`serialize(parse(x)) === x`) on every fixture, targeted edits, and error cases (unclosed marker, duplicate marker, malformed GVariant).
3. Add a `bash -n`/`zsh -n` check in `model.spec.ts` that pipes `renderBlock` output for both shells through the real binaries (skip zsh with a visible `it.skipIf` when `zsh` is absent, as on CI runners).
4. Add a hostile-value test: alias commands and export values containing `'`, `"`, `$()`, backticks and newlines render to text that `bash -n` accepts and that, when sourced in a subshell with a temp `HOME`, sets exactly the input value.

## Verification
- `bun --bun nx test term-config` passes with every module covered; `bun --bun nx lint term-config` is clean.
- The Ptyxis gschema fixture yields 89 keys with enums resolved.
- Inserting the omz block into the template fixture lands it directly above `source $ZSH/oh-my-zsh.sh`, and `zsh -c 'source fixture; print $ZSH_THEME'` with a stub `$ZSH/oh-my-zsh.sh` prints the managed theme.
- Schema parse of the Ghostty fixture yields 629 keys, with `theme` mapped to `theme`, `font-family` repeatable and `font`, and boolean keys detected.

## Rollback
Revert `libs/term-config/src/` to the phase 1 stub.
