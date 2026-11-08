# PR #11 re-review: fix commit e737306

Scope: I checked `git show HEAD` (7 files, +38/-9) against the earlier report `code-reviewer-261107-2325-pr11-bun-starlight.md`, then scanned `git diff main...HEAD` again (36 files) for anything new or regressed. This was a read-only review. No tracked files were edited and no processes were left running.

## Verdict

Nothing is BLOCKING and nothing is SHOULD-FIX. All four SHOULD-FIX items from the first review are resolved, three with code changes and one (S2) by labelling. The fixed NITs are correct. The accepted NITs stay accepted. There are two new NITs, both optional.

## Checks run

| Command | Result |
| --- | --- |
| `website: bun test` | 28 pass, 0 fail |
| `website: bun run check` | 0 errors, 0 warnings, 0 hints |
| `ubuntu: bun run lint` | pass |
| `ubuntu: bun run format:check` (now `--all`) | pass, exit 0 |
| `actionlint` (docker, repo root) | no findings, exit 0 |

## Per-finding verification

**S1: generated pages had a broken "Edit page" link. FIXED.**
- `render-toolchains.ts` now emits `editUrl: "<SOURCE_EDIT_BASE><id>.ts"` through `yamlString`.
- The regenerated `go.md` frontmatter contains `.../edit/main/ubuntu/libs/toolchains/src/toolchains/go.ts`.
- All 13 ids from `bun run dev list --json` have a matching tracked file in `ubuntu/libs/toolchains/src/toolchains/`: nvm-bun, bun-tools, go, rust, python, pyenv, java, jenv, flutter, android, cpp, docker and claude.
- The frontmatter test asserts the new line.

**S2: install commands without `--dry-run`. RESOLVED BY LABELLING (no code change).** Every command on the site that installs is labelled:
- **Hero** (`TerminalHero.astro`): the figcaption reads "Install and run", and the tagline mentions `--dry-run`. With a TTY, the copied `npx linux-toolchain` always ends at the `Proceed?` gate. `canConfirm = deps.tty && !config.yes` is at `install.ts:154`, and the confirm is at `:223`.
- **quick-start.mdx step 3**: both tabs are titled "Terminal (installs)". The step text says "This installs: nothing changes until you confirm the review at the end."
- **usage.mdx:113**: the caution aside says "That command **installs**; preview it with `--dry-run` first."
- **Inline prose mentions**, all labelled by their surrounding sentence:
  - `index.mdx:11`: "...and it installs them".
  - `usage.mdx:14`: "`install` is the default command".
  - `usage.mdx:20`: describes the interactive flow.
  - `usage.mdx:120`: "user-level tools then install".
  - The `how-it-works.mdx:28` heading.
- None of these is unlabelled.

**S3: the preview-comment step could match someone else's comment. FIXED.**
- The filter is now `select(.user.login == "github-actions[bot]" and (.body | startswith($marker)))`.
- I ran it on a sample with a spoofed comment by another user plus a bot comment. It returned only the bot comment's id.
- `GH_TOKEN` is `github.token`, so comments are authored by `github-actions[bot]`.

**S4: every page showed the same "Last updated" date. FIXED.** The docs build checkout now has `fetch-depth: 0`, with a comment explaining why. The deploy job has no checkout, so nothing else is affected.

**N3: FIXED.** The script is now `bun --bun nx format:check --all` and it passes. AGENTS.md was already in line with this.

**N4: FIXED.**
- `code()` now flattens `\r?\n` to a space before escaping pipes for tables.
- The test `code('a\nb|c', true) === '`a b\\|c`'` covers both behaviours together.

**N5: FIXED.**
- The path filters for both PR and push now cover `ubuntu/libs/**`, `ubuntu/package.json` and `ubuntu/tsconfig.base.json`.
- The AGENTS.md Deploy bullet was updated to match.

**N7: FIXED, and the command is correct.** The new line is `sudo env "PATH=$PATH" npx linux-toolchain --only go --defaults --dry-run`.
- The user's shell expands `$PATH` before sudo runs, and the double quotes keep it as one argument.
- `env` sets PATH and then finds `npx` through that PATH. The `#!/usr/bin/env node` shebang finds the nvm `node` the same way.
- `env` keeps sudo's `SUDO_USER`, so the CLI still targets the invoking user.
- It is safe: the example carries `--dry-run`, and the following sentence already tells the reader to remove `--dry-run` to install.
- Passing the user's PATH to a root process is the standard idiom. The user is already sudo-capable, so it adds no privilege.

**N8: FIXED.** AGENTS.md and ubuntu/README.md now list `LICENSE`, which matches the earlier `npm pack --dry-run` listing.

**Accepted findings (still accepted; I found no new evidence against them):**
- **N1:** `head_ref` in the wrangler-action `command` is tokenised by `@actions/exec`, with no shell involved.
- **N2:** `setup-bun` is unpinned in a deploy job that has no checkout and so no `package.json` to read the version from. Wrangler is also downloaded twice. Both cost time, not correctness.
- **N6:** an SVG favicon cannot read the site's CSS variables, so its colours have to be raw hex.

## BLOCKING

None.

## SHOULD-FIX

None.

## NIT (new, optional)

- **NA. The repository URL is now in two places.** `SOURCE_EDIT_BASE` in `website/scripts/render-toolchains.ts` hard-codes the URL, which already exists as `repo` in `website/astro.config.mjs:7`. They will drift if the repo is renamed or transferred. This is low risk, and a small shared constant would fix it.
- **NB. No check that each edit-link target exists.** If a toolchain's source file is renamed, the edit link will 404 again, and `starlight-links-validator` does not check external URLs. A test in `render-toolchains.test.ts` could assert that `ubuntu/libs/toolchains/src/toolchains/<id>.ts` exists for each id in the real `toolchains.json`. This is hardening only.

## Whole-diff rescan

`main...HEAD` (7 commits, 36 files) has no new risk beyond the HEAD commit, and the earlier "Verified clean" findings still hold. The HEAD commit changes only:
- the docs.yml path filters, checkout depth and jq filter;
- docs text in AGENTS.md, ubuntu/README.md and troubleshooting.mdx;
- one package.json script;
- the generator plus its test.

None of these touches the secret-handling surface, the tarball or the CLI source.

Status: DONE
Summary: 0 BLOCKING, 0 SHOULD-FIX, 2 NIT (both new and optional). All 4 earlier SHOULD-FIX items are resolved (S1, S3 and S4 by code, S2 by labelling, verified). N3, N4, N5, N7 and N8 are verified fixed, and N1, N2 and N6 remain accepted.
Concerns/Blockers: none
