---
phase: 4
title: "Phase 4: Docs CI, Cloudflare deploy, repo docs"
status: pending
priority: P1
effort: "3h"
dependencies: [1, 2, 3]
---

# Phase 4: Docs CI, Cloudflare deploy, repo docs

## Goal
Build and link-check the site on every relevant PR, deploy previews and production to Cloudflare Pages, and document `website/` for contributors and agents.

## Files to Create / Modify
- Create: `.github/workflows/docs.yml`:
  - Triggers: `pull_request` and `push` to `main`, on paths `website/**`, `ubuntu/apps/linux-toolchain/**`, `ubuntu/libs/toolchains/**`, `ubuntu/bun.lock`, `.github/workflows/docs.yml`; plus `workflow_dispatch`.
  - `permissions: { contents: read, deployments: write, pull-requests: write }`. `concurrency` per ref, cancelling in progress on PRs.
  - `build` job: checkout; `oven-sh/setup-bun@v2`; cache `~/.bun/install/cache` keyed on both lockfiles; `bun install --frozen-lockfile` in `ubuntu/` and `website/`; `bun test` and `bun run build` in `website/`; upload `website/dist` as an artifact.
  - `deploy` job (needs `build`). Job-level `if:` cannot read `secrets`, so the job maps `CF_TOKEN_SET: ${{ secrets.CLOUDFLARE_API_TOKEN != '' }}` into `env` and the steps use `if: env.CF_TOKEN_SET == 'true'` (fork PRs skip them, with a notice). It downloads the artifact, then runs `cloudflare/wrangler-action@v4` with `command: pages deploy dist --project-name=linux-toolkits-docs --branch=${{ github.head_ref || github.ref_name }}`, using `apiToken`/`accountId` from secrets. On PRs it posts or updates one comment with the preview URLs (`deployment-url`, and `pages-deployment-alias-url` for the stable branch alias). These output names were verified in the action.yml of wrangler-action v4.1.3.
- Modify: root `README.md`: add `website/` to the layout table and a docs link (production URL).
- Modify: `AGENTS.md`: a "Docs site (website/)" section covering commands (`bun install`, `bun run dev`, `bun run build`), the generated-content rule (never hand-edit `ubuntu/toolchains/*.md`; change the catalog), theme token rules (tokens in `theme.css`, no raw hex, contrast ≥4.5:1), and the deploy flow. Add `website/` to the repository layout table.
- Modify: `ubuntu/apps/linux-toolchain/README.md`: link to the docs site.
- Modify: `ubuntu/apps/linux-toolchain/package.json`: `homepage` = docs URL (published with the next version only, no republish now).

## Tasks & Steps
1. After the user has set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, check that they exist (`gh secret list`, names only). Create the Pages project once: `bunx wrangler pages project create linux-toolkits-docs --production-branch=main`, with the token taken from the environment, never echoed. If the project already exists, continue. If the token lacks Pages:Edit, stop and ask.
2. Write `docs.yml` and run actionlint on it.
3. Open the PR. CI builds, the preview deploy succeeds, and the PR comment shows a preview URL. Open the preview and check the home page, one guide and one toolchain page.
4. Update README, AGENTS.md and the CLI README.
5. After merge, the production deploy runs on `main`. `curl -sI https://linux-toolkits-docs.pages.dev/` returns 200, and `/ubuntu/toolchains/java/` returns 200.

## Verification
- PR checks: CI (phase 1) and Docs build/deploy are green.
- The production URL serves the site, with dark default, search working (Pagefind) and all 13 toolchain pages.
- No secret value appears in logs (the wrangler-action masks the token; check that no step echoes the env).

## Security
- The token reaches only the deploy job, through `secrets.*`. Fork PRs don't get it, so they get no deploy.
- The token is scoped to Cloudflare Pages:Edit on one account.
