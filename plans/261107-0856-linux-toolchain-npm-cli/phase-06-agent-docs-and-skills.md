---
phase: 6
title: "Phase 6: Agent Docs and Built-in Skills"
status: todo
priority: P2
effort: "2h"
dependencies: [1]
---

# Phase 6: Agent Docs and Built-in Skills

## Goal
Give agents working in the workspace one source of truth (`ubuntu/AGENTS.md`), referenced from `ubuntu/CLAUDE.md`. Ship skills for obra superpowers, Nx and bash/zsh shell work: plugin references for the third-party ones and one repo-authored shell skill (decided at intake).

## Files to Create
- `ubuntu/AGENTS.md`: the canonical agent guide:
  - Layout: `apps/linux-toolchain`, `libs/core`, `libs/toolchains`, and the legacy `install-toolchains.sh` (kept as reference; parity notes live in the toolchains specs).
  - Commands: `npx nx run-many -t lint test build`, `npx nx test toolchains`, the dry-run invocation, and how to add a toolchain (new file under `libs/toolchains/src/toolchains/`, register it in the catalog, extend the specs).
  - Invariants: every side effect goes through `Runner`; `shQuote` all interpolation; ≤3 add-ons per toolchain; markers stay byte-identical to the bash script; zero runtime deps in the published manifest.
  - The release procedure from phase 5, and the Nx version in use.
  - Skills section: which skills exist, when to use each, and their paths.
- `ubuntu/CLAUDE.md`: a short file whose main line is `@AGENTS.md` (Claude Code import), plus Claude-specific notes only, such as the plugins listed below.
- `ubuntu/.claude/settings.json`:
  - `enabledPlugins`: `"superpowers@claude-plugins-official": true`. This was verified on 2026-11-07 in the local plugin catalog: obra's superpowers is published in the built-in official marketplace, so no `extraKnownMarketplaces` entry is needed. AGENTS.md names `github.com/obra/superpowers` for non-Claude agents.
- Nx skills / MCP: run `npx nx configure-ai-agents` (check `--help` first) from `ubuntu/` and keep what it generates (Nx MCP config, Nx agent rules/skills). If it writes into `AGENTS.md`/`CLAUDE.md`, merge its block into the files above rather than keeping duplicates. [UNVERIFIED: exact output of `configure-ai-agents` for the installed Nx version. Confirm during execution and record the result in AGENTS.md.]
- `ubuntu/.claude/skills/shell-scripting/SKILL.md`: repo-authored bash/zsh skill:
  - Frontmatter name and description: triggers on editing `.sh` files, rc files and shell snippets generated in `libs/core/src/shell.ts`.
  - Rules: `set -euo pipefail` / `set -uo pipefail` choices; quoting and `shQuote`; heredoc quoting (`<<'EOF'` vs `<<EOF`); idempotent rc and profile.d edits with markers; bash vs zsh startup-file differences (`.bashrc`, `.zshrc`, `/etc/profile.d` not read by non-login shells); `bash -n` + `shellcheck` before commit; `sudo` vs `runuser` semantics.
- `ubuntu/.agents/skills/shell-scripting`: a relative symlink to `../../.claude/skills/shell-scripting`, so AGENTS.md-driven agents (Codex, etc.) find the same skill without a second copy.

## Tasks & Steps
- [ ] 1. Write AGENTS.md and CLAUDE.md from the final state of phases 1-5 (re-read the code first; document only what exists).
- [ ] 2. Add `.claude/settings.json` that enables `superpowers@claude-plugins-official`.
- [ ] 3. Run `npx nx configure-ai-agents`, then review and merge its output.
- [ ] 4. Author the shell-scripting skill and the `.agents` symlink.

## Verification
- Opening Claude Code in `ubuntu/` offers to install the superpowers plugin, and `/plugin` lists it as enabled.
- `claude` in `ubuntu/` loads AGENTS.md via the import (check with `/memory`).
- The Nx MCP/skills from `configure-ai-agents` are listed in the session.
- Links and paths in AGENTS.md resolve: `grep -o '`[^`]*/[^`]*`' AGENTS.md`, checked against the tree.

## Notes
- Phase 6 depends only on phase 1 for layout, but its final pass runs last so the docs match the shipped commands.
