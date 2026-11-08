# Phase 4 report: web shell, design system and terminal

Date: 2026-11-08 (Asia/Saigon). Branch `feat/td-p4`. Refs #13.

## Built

All under `ubuntu/apps/term-dashboard-web/src/`.

- **Tokens and global CSS.** `styles/theme.css` is the only file with colour values. It holds the shadcn/ui variables plus `--run`, `--warn`, `--cta` and `--link`, the xterm `--term-*` colours and the `--ansi-*` palette for both modes, along with the contrast table. `styles/global.css` maps the tokens to Tailwind v4 (`@theme inline`) and self-hosts JetBrains Mono Variable and IBM Plex Sans 400/500/600 through fontsource, so the page makes no external font requests. It also sets a visible 2px `--ring` focus outline and turns off animations and transitions under `prefers-reduced-motion`.
- **UI primitives** in `components/ui/`, built on `radix-ui` in the shadcn style: button (the `cta` variant is reserved for Apply/Save), card, badge (run/warn/destructive/muted), tabs, switch, select, slider, input, textarea, dialog, sheet, alert-dialog, tooltip, scroll-area, separator, and a dependency-free toast. `components/state-panel.tsx` covers loading, empty and error states. Icons come only from lucide.
- **`lib/api.ts`**: a typed client over `@linux-toolchain/term-config` (`API_PATHS`, `Health`, `Settings`, `TerminalInventory`, ...). The launch-code exchange from phase 1 is unchanged and moved to `lib/session.ts`. A 401 clears the stored token and shows "Session expired: restart td or reopen its URL." A 409 opens a "File changed on disk" alert dialog with Reload. `useResource` loads a resource and offers retry. `describeError` turns a 404 into "This td server does not provide X".
- **`lib/activity.ts`** (with `lib/sse.ts`): reads `/api/activity` using `fetch` and `ReadableStream` with the bearer header, so the token never appears in a URL. An incremental SSE parser handles split chunks, CRLF and heartbeat comments. Reconnects back off 1 to 30 s. The stream stops on 401 and on 404 (route missing). `ActivityStore` folds started/output/exited events into commands under the server's caps (`ACTIVITY_LIMITS`: 500 commands, 2 MB) and clears itself on each reconnect, because the server replays its history then.
- **`lib/theme.ts`**: dark is the default. The inline script in `index.html` applies the `sessionStorage` cache (`td.theme`) before first paint. `settings.theme` from `GET /api/settings` is authoritative. Changes apply at once and are saved with `PUT /api/settings`; if the save fails, a toast explains that the theme applies to this tab only.
- **Frame**:
  - `app/router.tsx` is a History API router of about 60 lines.
  - `app/nav.ts` defines the navigation. GNOME Terminal and zsh appear only when the inventory reports them.
  - `app/layout/sidebar.tsx` is a fixed sidebar from 768 px up. Below that it becomes a radix sheet.
  - `app/layout/top-bar.tsx` holds the page title, the connection status (Live / Reconnecting / No stream / Signed out, with a glow only on Live), the theme toggle and the `td` version from `/api/health`.
  - `app/layout/activity-panel.tsx` is a bottom panel resized by dragging or by the arrow, PageUp/PageDown and Home/End keys on a `role="separator"`. It is collapsible, keeps its state in `sessionStorage`, and starts collapsed below 768 px.
  - There is a skip link, and focus moves to `<main>` on navigation.
- **`features/overview/overview-page.tsx`**: cards for Ghostty (version, config files), Ptyxis and GNOME Terminal when installed (version, gsettings schema), shells (binary, login shell, managed block, oh-my-zsh, last backup), and the last 10 commands.
- **`features/activity/activity-list.tsx`**: one row per command showing the argv joined with spaces, a status badge (running / exit N / signal) and the duration and time. Output expands with stdout and stderr coloured differently, plus a truncation notice. While the list is scrolled to the bottom it follows new output; scrolling up pauses that, and "Jump to latest" resumes it. "Copy command" copies the argv quoted for the shell.
- **`features/terminal/terminal-page.tsx`** (lazy-loaded, so xterm.js is its own 337 kB chunk):
  - xterm 6 with the fit add-on. The theme comes from the `--term-*`/`--ansi-*` tokens and follows the app theme.
  - Connects to `/ws/pty` with the subprotocols `['td', token]`. Binary frames carry data in both directions.
  - A `ResizeObserver` triggers fit and sends `{type:'resize', cols, rows}` when the size changes, and the size is measured again after the fonts load.
  - Handles the `ready`, `exit` and `error` messages and shows a Reconnect button after exit or disconnect. The socket closes on unmount and on `pagehide`.
  - When `inventory.pty.available` is false, the page shows the server's reason instead.
- `features/placeholder/pending-page.tsx` is a "Coming in this build" stand-in for Ghostty, Ptyxis, GNOME Terminal, bash, zsh and Backups; phase 5 replaces it. `not-found-page.tsx` handles unknown paths.
- Cherry-picked `66a92b8` (`feat(term-config): add API contract types`) from `feat/td-p2` as `98e8638`.

## Checks

| Check | Result |
|---|---|
| `bun --bun nx run-many -t lint test build -p term-dashboard-web` | exit 0. 6 spec files, 26 tests. No chunk-size warning after lazy-loading the terminal page (main 377 kB, terminal 337 kB) |
| `bun run lint && bun run test && bun run build && bun run format:check` (workspace) | exit 0 |
| Specs | `theme-toggle.spec.tsx`: the toggle persists through settings, the theme survives a reload or new tab via settings, and a failed save keeps the theme and reports the error. `activity-list.spec.tsx`: a started/output/exited sequence renders live with stdout/stderr colouring and the truncation notice; failure badge and shell-quoted copy; auto-scroll pauses and resumes. `api.spec.ts`: bearer header, 401 and 409 events, non-JSON errors, unreachable server, 404 wording. `activity.spec.ts`: folding, both caps, evicted ids, stream with reconnect and stop on 401 and 404. `sse.spec.ts`, plus the existing `session.spec.ts` |
| Screenshots, 375/768/1024/1440 in dark and light | `plans/reports/screens-261108-td-phase4/`: overview and terminal at each width, the pending page and the open nav sheet at 375, focus, the toggle toast and the session-expired screen. The raw probe output is in `checks.txt` there |
| Horizontal scroll | None. `scrollWidth == innerWidth` at every width in both modes, including with the nav sheet open at 375 |
| First paint | A fresh session renders with `class="dark"` |
| Keyboard | Tab order is: skip link, the nav links, connection status, theme toggle, page content, activity panel resizer, activity toggle. Every focused element shows a solid 2px outline |
| Reduced motion | With `prefers-reduced-motion: reduce` emulated, the live-dot animation and the nav transitions compute to 0.01 ms |
| Processes | td, Vite and the headless Chrome were stopped. `pgrep -fa 'term-dashboard\|vite'` finds nothing, and ports 4777, 5173 and 9339 are free |

Screenshot method: the Playwright and chrome-devtools MCP tools were not available in this session (there was no ToolSearch). Instead, a scratch script drove `/usr/bin/google-chrome --headless=new` over the DevTools protocol using Node's built-in WebSocket, so no dependency was added. It ran against `bun run dev:td` with `HOME`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` set to fresh `mktemp -d` folders. Launch codes were minted through `POST /api/launch-code` with the instance secret from the sandbox instance file.

## Contrast table summary

The full table is in the header comment of `theme.css`. Ratios were computed from the hex values using WCAG relative luminance.

- **Text on surfaces.** Each of foreground, muted-foreground, link, destructive, run and warn was checked on each of background, card, popover, muted and accent, in both modes. The lowest results are 5.46 in dark (destructive on accent) and 5.24 in light (run on accent). Body text is 16.27 dark and 16.77 light; muted text is at least 6.09 dark and 6.24 light.
- **Foreground on fills.** primary 5.23 / 5.17, destructive 6.95 / 6.47, run 11.03 / 6.35, warn 11.51 / 6.38, cta 6.86 / 6.86, terminal 16.27 / 14.68 (dark / light).
- **Focus ring** on the background: 5.23 dark, 4.85 light. The target for non-text elements is 3:1.
- **Choices this forced.** Dark mode uses dark text on primary blue, because white on #3B82F6 is 3.68. The CTA (#F97316) uses dark text in both modes, because white is 2.8. Light-mode run and warn were darkened to #126E34 and #8A5206 so they stay at or above 4.5 on the accent surface. Primary blue as text uses `--link` (#60A5FA dark, #1D4ED8 light).

## Deviations

- **Phase-3-dependent states only.** The phase-1 server has no `/api/inventory`, `/api/settings` or `/api/activity` routes, so the screenshots show the production error and empty states, not data cards or a live xterm. The terminal page code is complete, but the live checks (`tput cols` after a resize, the shell ending when the tab closes) wait for phase 3, as agreed. The theme round-trip through `settings.json` is covered by the spec; against this server, the toggle applies and shows the "Theme not saved" toast.
- **Screenshot tool.** A CDP script was used instead of the Playwright or chrome-devtools MCP, as described above.
- **File move.** `session.ts` and its spec moved to `lib/` unchanged. The rename landed in the first code commit, so that commit on its own has a stale `./session` import in `app.tsx`; the second commit fixes it, and the branch head builds.
- **Bundle split.** The terminal page is lazy-loaded with `React.lazy`. This is not in the spec; it keeps xterm out of the main chunk and removes Vite's 500 kB warning.
- **Extra files.** `components/ui/sheet.tsx` was added for the mobile navigation, and `lib/sse.ts`, `lib/format.ts` and `app/shell-data.tsx` were split out as small helpers.

## Open questions

- None blocking. Phase 5 should replace `PENDING` in `app/routes.tsx` with the real pages.
