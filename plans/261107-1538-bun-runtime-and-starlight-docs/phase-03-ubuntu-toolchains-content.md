---
phase: 3
title: "Phase 3: Ubuntu toolchains content"
status: pending
priority: P1
effort: "4h"
dependencies: [1, 2]
---

# Phase 3: Ubuntu toolchains content

## Goal
Write the Ubuntu section as the site's first content: hand-written guides plus a toolchain reference generated from `list --json`.

## Content map (`website/src/content/docs/ubuntu/`)
| Page | Source |
|---|---|
| `index.mdx` Overview: what it installs, supported systems (apt, Node ≥22.13), safety model | Hand-written from `ubuntu/apps/linux-toolchain/README.md` |
| `quick-start.mdx`: `npx`/`bunx`, first interactive run, `--dry-run` first | Hand-written |
| `usage.mdx`: interactive flow (select, sub-options, add-ons, review); flags `--all/--only/--defaults/--opt id.key=value/--user/-y/--dry-run`; `list`, `list --json`; exit codes 0/1/2/130 | Hand-written; flags checked against `bun run dev -- --help` |
| `how-it-works.mdx`: per-step sudo vs `sudo npx` + `runuser`, rc/profile markers shared with `install-toolchains.sh`, add-on failures become warnings | Hand-written from AGENTS.md "Architecture" (user-facing parts only) |
| `troubleshooting.mdx`: sudo prompts, PATH not updated until new shell, non-apt distro error, re-running is idempotent | Hand-written |
| `toolchains/index.mdx`: table of all 13 (id, label, description, requires) linking to each page | Generated data, rendered by a component |
| `toolchains/<id>.md` × 13: description, options table (key, kind, choices, default), add-ons with hints, requires/addonImplies, example `--opt` and `--only` commands | Generated |

## Files to Create
- `website/scripts/gen-toolchains.ts`: runs `bun ../ubuntu/apps/linux-toolchain/src/main.ts list --json`, validates the shape (13 entries, each with id/label/options; fail loudly on a missing field), and writes `src/content/docs/ubuntu/toolchains/<id>.md` and `src/data/toolchains.json`. Output is deterministic (stable order = catalog order) and starts with a "generated, do not edit" comment.
- `website/package.json` scripts: `gen` = `bun scripts/gen-toolchains.ts`; `predev`/`prebuild` run `gen`.
- `website/.gitignore`: add `src/content/docs/ubuntu/toolchains/*.md` and `src/data/toolchains.json`.
- `website/src/components/ToolchainTable.astro`: renders the index table from `src/data/toolchains.json`.
- The hand-written pages listed above.
- `website/astro.config.mjs`: sidebar group "Ubuntu toolchains" with the guides, then a collapsed "Toolchains" subgroup using `autogenerate: { directory: 'ubuntu/toolchains' }`.
- `website/scripts/gen-toolchains.test.ts` (`bun test`): feeds a fixture through the renderer and asserts the Markdown for one option of each kind (select, multi, confirm) and for add-on hints.

## Tasks & Steps
1. Write the generator and its renderer as a pure function (JSON in, files out), plus the test.
2. Run `bun run gen`. Spot-check `java.md` (JDK select, maven/gradle confirms, add-ons) and `bun-tools.md` (requires `nvm-bun`).
3. Write the guide pages. Every flag and default shown must match `bun run dev -- --help` and `list --json`. Any example command that would install must include `--dry-run`, or be clearly labelled as installing.
4. `bun run build`. The links validator must pass, with all 13 toolchain pages in the sidebar.
5. Proofread for consistency with the CLI README; link to the README on npm rather than duplicating long tables already generated here.

## Verification
- `cd website && bun test && bun run build` passes. The build output contains 13 pages under `ubuntu/toolchains/`.
- Changing a toolchain label in the catalog, then `bun run gen`, changes the generated page (then revert the change).
- `rg -n -- '--opt|--only|--defaults' website/src/content/docs/ubuntu/*.mdx`: each example parses with `bun run dev -- <args> --dry-run` (run the examples).
