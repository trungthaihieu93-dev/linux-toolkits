---
phase: 2
title: "Phase 2: Starlight site and tech theme"
status: pending
priority: P1
effort: "5h"
dependencies: []
---

# Phase 2: Starlight site and tech theme

## Goal
Scaffold `website/` as a bun-managed Astro + Starlight site with a terminal-flavoured tech theme that passes accessibility checks in dark and light mode.

## Design (from ak-ui-ux-pro-max + ak-ui-styling)
- **Style:** dark mode first (OLED-friendly deep neutrals, not pure black on large surfaces), high contrast, minimal glow only on the hero prompt. Light mode is fully supported but is not the default.
- **Typography:** IBM Plex Sans (body/headings) and JetBrains Mono (code, kbd, hero prompt), self-hosted via `@fontsource/ibm-plex-sans` and `@fontsource-variable/jetbrains-mono` (no Google Fonts request). Base 16px, line-height ≥1.5.
- **Color tokens:** Starlight's `--sl-color-accent-*` mapped to the blue primary (#2563EB / #3B82F6, adjusted per mode for ≥4.5:1). A green "run" token for terminal prompts and success, and orange (#F97316) only for a single CTA/caution accent. Tokens live in `src/styles/theme.css` and components reference tokens, never raw hex.
- **Tailwind v4** through `@astrojs/starlight-tailwind` (`src/styles/global.css` with `@layer base, starlight, theme, components, utilities`), for custom components only. Starlight's own UI stays as is.
- **Code blocks:** Expressive Code with a dark/light theme pair matched to the tokens, plus terminal frames for shell snippets.
- **Icons:** Starlight's built-in `<Icon>` (SVG) only, no emoji as icons.
- **Default dark:** override Starlight's `ThemeProvider` so the stored choice wins, otherwise dark. The theme picker still offers auto/light/dark.
- **Motion:** 150-300ms transitions on hover/focus only, all disabled under `prefers-reduced-motion`.

## Files to Create
- `website/package.json` (`packageManager: bun@1.4.4`; scripts `dev`, `build`, `preview`, `check` = `astro check`; all via `bun --bun astro`), `website/bun.lock`.
- `website/astro.config.mjs`: `site` = `https://linux-toolkits-docs.pages.dev`; Starlight with title `toolkits`, GitHub social link to `trungthaihieu93-dev/linux-toolkits`, `editLink` to `main/website/`, `customCss`, `components: { ThemeProvider }`, the `starlight-links-validator` plugin, `lastUpdated: true`, and a sidebar with an "Ubuntu toolchains" group (filled in phase 3).
- `website/tsconfig.json` (extends `astro/tsconfigs/strict`), `website/src/content.config.ts` (`docsLoader` + `docsSchema`).
- `website/src/styles/global.css`, `website/src/styles/theme.css`.
- `website/src/components/ThemeProvider.astro` (default-dark override).
- `website/src/components/TerminalHero.astro`: splash hero showing `$ npx linux-toolchain` with a copy button (an accessible `<button>` with label and live-region feedback).
- `website/src/content/docs/index.mdx`: splash page (template `splash`) with TerminalHero and one CardGrid card linking to the Ubuntu section. No placeholder cards for future topics.
- `website/public/favicon.svg` (a simple terminal glyph).
- `website/.gitignore` (`dist/`, `.astro/`, `node_modules/`, generated content from phase 3).
- `website/README.md`: how to develop and build the site.

## Tasks & Steps
1. `bun create astro@latest website --template starlight --no-install --no-git --skip-houston --yes`, then delete the template's sample pages and its `AGENTS.md` (the root `AGENTS.md` is the single guide; phase 4 adds a website section).
2. `bun add @astrojs/starlight-tailwind tailwindcss @tailwindcss/vite @fontsource/ibm-plex-sans @fontsource-variable/jetbrains-mono starlight-links-validator` and `bun add -d @astrojs/check typescript`.
3. Write the theme tokens and overrides, then compute contrast for every text/background token pair in both modes (record the ratios in a comment table in `theme.css`).
4. Build the splash page and TerminalHero.
5. `bun run check && bun run build`, then preview and screenshot at 375, 768, 1024 and 1440px in dark and light mode (Playwright or chrome-devtools MCP). Check keyboard focus order and visible focus on the hero copy button, the search, the theme picker and the sidebar.
6. Run the ak-ui-ux-pro-max pre-delivery checklist (`references/quick-reference-rules.md` §1, §5, §6, §7) against the screenshots.

## Verification
- `cd website && bun install --frozen-lockfile && bun run check && bun run build` exits 0.
- With cleared localStorage the site renders dark. Selecting light persists across reloads.
- Contrast table: every body/muted/accent text pair is ≥4.5:1 (large text ≥3:1).
- No horizontal scroll at 375px. With reduced motion emulated, no transitions.

## Rollback
Delete `website/`.
