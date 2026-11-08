---
phase: 4
title: "Web shell, design system and terminal"
status: pending
priority: P1
effort: "6h"
dependencies: [1, 2]
---

# Phase 4: Web shell, design system and terminal

## Goal
Build the dashboard frame (theme, layout, navigation, activity panel, overview and terminal page) with a tech-dashboard look that meets the accessibility checklist in both modes.

## Design (ak-ui-ux-pro-max + ak-ui-styling)
- **Style:** Dark Mode (OLED) operations console. Deep neutral surfaces (not pure black on large areas), hairline borders, dense data layout, status dots, monospace numerics. Minimal glow only on the live indicator. Light mode is complete but never the default.
- **Typography:** JetBrains Mono for labels, values, code, terminal and headings; IBM Plex Sans for body text and descriptions (matches the docs site). Self-hosted via `@fontsource-variable/jetbrains-mono` and `@fontsource/ibm-plex-sans`; no external font requests.
- **Tokens:** shadcn/ui CSS variables (`--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--accent`, `--destructive`, `--border`, `--ring`) plus `--run` (green, live/success), `--warn` and `--cta` (#F97316, used only for Apply/Save). Primary blue #3B82F6 dark / #2563EB light. All tokens in `src/styles/theme.css` with a contrast table comment; components use tokens only, never raw hex.
- **Components:** shadcn/ui on `radix-ui` + Tailwind v4, copied into `src/components/ui/` (button, card, tabs, switch, select, slider, input, textarea, dialog, alert-dialog, tooltip, badge, scroll-area, separator, toast/sonner-free simple toast). Icons from `lucide-react` only; no emoji icons.
- **Motion:** 150-250 ms on hover/focus and panel open; disabled under `prefers-reduced-motion`.
- **Layout:** left sidebar (Overview, Ghostty, Ptyxis, GNOME Terminal when present, Shells → bash/zsh, Terminal, Backups), top bar (connection status, theme toggle, `td` version), resizable bottom activity panel. Sidebar collapses to a sheet below 768px; no horizontal scroll at 375px.

## Files to create (under `ubuntu/apps/term-dashboard-web/src/`)
- `styles/theme.css`, `styles/global.css` (Tailwind `@import`, `@theme inline` mapping tokens, font faces).
- `lib/api.ts`: typed `fetch` wrapper using `@linux-toolchain/term-config` API types; on first load exchanges the `#c=` launch code via `POST /api/session`, stores the session token in `sessionStorage` and clears the fragment; maps 401 to a "Session expired: restart td or reopen its URL" screen and 409 to a "File changed on disk" reload prompt.
- `lib/activity.ts`: reads `/api/activity` with `fetch` + `ReadableStream` and the bearer header (no token in the URL), parses SSE frames, reconnects with backoff, and keeps the same 500-command / 2 MB cap as the server.
- `lib/theme.ts`: reads `settings.theme` from the API, applies `class="dark"` on `<html>` before first paint (inline script in `index.html` reads a `sessionStorage` cache, default dark), persists changes through `PUT /api/settings`.
- `app/router.tsx`: a small local router on the History API (`pushState` + `popstate`, about 40 lines). No router dependency; the server already falls back to `index.html`.
- `app/layout/{sidebar,top-bar,activity-panel,theme-toggle}.tsx`.
- `features/overview/overview-page.tsx`: cards for detected terminals (name, version, config path, status), shells (default login shell from settings/inventory, managed block present, last backup) and the last 10 activity events.
- `features/terminal/terminal-page.tsx`: xterm.js with `@xterm/addon-fit`, theme colours from tokens (switches with the app theme), WS `/ws/pty` with the token subprotocol, `ResizeObserver` → fit → send `{type:'resize', cols, rows}`, reconnect button on exit, disabled state with the server's reason when `script` is missing.
- `features/activity/activity-list.tsx`: one row per command (argv rendered with spaces, status badge, duration), expandable output with stdout/stderr colouring, auto-scroll that pauses when the user scrolls up, "copy command" action.
- `components/ui/*` as listed above.
- Specs (`vitest` + `@testing-library/react` + `jsdom`): theme toggle persists, activity list renders started/output/exited sequence, API wrapper handles 401/409.

## Tasks & steps
1. Tokens and global CSS first; compute contrast for every text/background pair in both modes and record the table.
2. Layout, routing, theme and API wrapper against the phase 2 `api.ts` types.
3. Activity panel and overview.
4. Terminal page.
Steps 1-3 need only phases 1 and 2; step 4 and the checks below need phase 3's routes.
5. With `bun run dev:td` running in a sandboxed `HOME`, screenshot at 375, 768, 1024 and 1440 px in dark and light (Playwright or chrome-devtools MCP), check keyboard focus order, visible focus and reduced motion; run the ak-ui-ux-pro-max pre-delivery checklist.

## Verification
- `bun --bun nx run-many -t lint test build -p term-dashboard-web` exits 0.
- Fresh session renders dark; switching to light survives reload and a `td` restart (stored in `settings.json`).
- In the Terminal page `tput cols` changes after resizing the browser window; closing the tab ends the shell process.
- Contrast table: body, muted and accent text ≥4.5:1 in both modes.

## Rollback
Revert `apps/term-dashboard-web/src/` to the phase 1 placeholder.
