---
phase: 1
title: "Workspace scaffold, CLI, server shell and link"
status: completed
priority: P1
effort: "5h"
dependencies: []
---

# Phase 1: Workspace scaffold, CLI, server shell and link

## Goal
Create the three Nx projects and a build that produces a linkable `td` package that serves a placeholder web page through the guarded Hono server.

## Files to create / modify (paths under `ubuntu/`)
- Create `apps/term-dashboard/` with `project.json` (copy the `linux-toolchain` esbuild target: `platform: node`, `format: esm`, `thirdParty: true`, node22 target, the same `createRequire` banner; output `dist/apps/term-dashboard`; assets `package.json`, `README.md`, `LICENSE`, and `{ input: "dist/apps/term-dashboard-web", glob: "**/*", output: "web" }`; `implicitDependencies: ["term-dashboard-web"]`), `package.json` (name `linux-term-dashboard`, `bin: { "td": "main.js" }`, `files: ["main.js", "web", "README.md", "LICENSE"]`, `engines.node >=22.13`, `os: ["linux"]`, no `dependencies`, `"private": true` until the maintainer approves the first publish), `tsconfig*.json`, `vitest.config.mts`, `eslint.config.mjs`, `LICENSE`, `README.md` (stub, completed in phase 6).
- Create `apps/term-dashboard/src/main.ts`, `src/cli/program.ts` (commander: `td [--port <n>] [--no-open]`, `--version` read from package.json at build time like linux-toolchain), `src/server/app.ts` (Hono app factory taking deps), `src/server/guard.ts`, `src/server/static.ts`, `src/server/listen.ts`.
- Create `apps/term-dashboard-web/` with `project.json` (targets via `@nx/vite` or `nx:run-commands` around `vite build`; output `dist/apps/term-dashboard-web`), `vite.config.mts` (React plugin, `@tailwindcss/vite`, dev proxy `/api` and `/ws` to the dev server port), `index.html`, `src/main.tsx` rendering a placeholder that calls `GET /api/health`, `tsconfig*.json`, `eslint.config.mjs`.
- Create `libs/term-config/` (`project.json`, `src/index.ts`, `tsconfig*.json`, `vitest.config.mts`, `eslint.config.mjs`) and add `"@linux-toolchain/term-config": ["./libs/term-config/src/index.ts"]` and `"@linux-toolchain/core/shell": ["./libs/core/src/shell.ts"]` to `tsconfig.base.json` paths. The second alias exposes the pure snippet helpers (`shell.ts` has no imports) without pulling the Node-only core barrel (`runner`, `system`) into the browser bundle. The web app's `vite.config.mts` sets `resolve.alias` for both aliases.
- Modify `ubuntu/package.json`: devDependencies listed below; scripts `dev:td` (`bun --bun nx run-many -t serve -p term-dashboard term-dashboard-web --parallel=2`; the CLI project gets a continuous `serve` target running `bun apps/term-dashboard/src/main.ts --no-open --port 4777 --dev-origin http://localhost:5173`, the web project a continuous `serve` target running `vite`), `link:td` (`bun --bun nx build term-dashboard && cd dist/apps/term-dashboard && bun link`), `unlink:td` (`cd dist/apps/term-dashboard && bun unlink`).
- Modify `.gitignore` if needed (dist is already ignored).

## Dependencies (devDependencies, inlined or built, never runtime deps)
`hono`, `@hono/node-server`, `@hono/node-ws`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `radix-ui`, `lucide-react`, `class-variance-authority`, `tailwind-merge`, `clsx`, `monaco-editor`, `@monaco-editor/react`, `@xterm/xterm`, `@xterm/addon-fit`, `@fontsource-variable/jetbrains-mono`, `@fontsource/ibm-plex-sans`, `diff`, `@testing-library/react`, `jsdom`. Pin to the versions in plan Evidence with `^`.

## Server shell behaviour
- Bind `127.0.0.1` only. Default port 4777; `--port 0` picks a free port (used by tests).
- Session token: `crypto.randomBytes(32).toString('base64url')` per run, never placed in a URL or in any process argv.
- Launch code: the printed and opened URL is `http://127.0.0.1:<port>/#c=<code>`, where `<code>` is single-use and expires after 60 s. The page `POST`s it to `/api/session` and receives the session token, keeps it in `sessionStorage` and clears the fragment. Other local users can read `xdg-open`'s argv (`/proc` has no `hidepid`), but they only see a spent or expiring code. A new code is minted by `POST /api/launch-code` with the instance secret (below), or by restarting `td`.
- `guard.ts`: reject unless `Host` is `127.0.0.1:<port>` or `localhost:<port>` (or the `--dev-origin` host); `/api/*` except `GET /api/health` and `POST /api/session` requires `Authorization: Bearer <token>`; the activity stream is read with `fetch` + `ReadableStream` (not `EventSource`) so it also uses the header and the token never appears in a query string; WS requires `Origin` equal to the server origin (or `--dev-origin`) and the token as `Sec-WebSocket-Protocol`. Compare secrets with `timingSafeEqual`. JSON bodies are size-limited (1 MB for file content, 16 KB otherwise).
- `GET /api/health` returns `{ app: "term-dashboard", version, pid }` and no secrets.
- Instance file: after binding, write `$XDG_RUNTIME_DIR/term-dashboard/instance.json` (dir `0700`, file `0600`; fall back to `~/.local/state/term-dashboard/` when `XDG_RUNTIME_DIR` is unset) with `{ port, pid, instanceSecret }`; delete it on exit.
- Port reuse: on start, if the instance file exists, its pid is alive and `/api/health` on its port reports the same pid, mint a launch code with `instanceSecret`, open that URL, print "td already running (pid N)" and exit 0. Otherwise, on `EADDRINUSE` exit 1 naming the port and suggesting `--port`. A process answering on the port without a matching instance file is never trusted.
- Hidden `--dev-origin <url>` flag, used only by `dev:td`: adds the Vite dev origin to the Host/Origin allowlist and prints the launch URL on that origin. The Vite proxy keeps `changeOrigin: false` and proxies `/ws` with `ws: true`.
- Refuse to start the server as root (`process.getuid() === 0`) with a clear message. `--help` and `--version` still work as root (the CI smoke job runs as root).
- Open the browser with `xdg-open` via `execFile` (skipped with `--no-open` or when `DISPLAY`/`WAYLAND_DISPLAY` are unset).
- `static.ts`: serve `new URL('./web/', import.meta.url)` with correct content types and an SPA fallback to `index.html`; in `dev:td` the Vite dev server serves the UI instead.
- SIGINT, SIGTERM and SIGHUP (closing the launching terminal): close the server, delete the instance file and run registered cleanups (phase 3 registers PTY kills).

## Tasks & steps
1. Generate the projects with Nx generators where they fit (`nx-generate` skill first; `@nx/js:lib` for the lib, `@nx/node:app` or a copy of the linux-toolchain layout for the CLI, `@nx/react` only if it does not pull runtime deps into the CLI manifest), then align configs with `linux-toolchain`.
2. `bun add -d` the dependencies above; confirm `bun.lock` changes and that `apps/term-dashboard/package.json` has no `dependencies`.
3. Implement the CLI, guard, static serving, health, port reuse and root refusal.
4. Unit tests (`app.spec.ts`, `guard.spec.ts`, `instance.spec.ts`) using `app.request()`: missing token 401, wrong Host 403, health without token 200, launch code works once and expires, SPA fallback, oversized body 413, instance file mode 0600 and stale-file handling. The WS origin rejection is tested against the real upgrade path in phase 3 and in e2e.
5. Probe `@hono/node-ws` upgrade under `node dist/apps/term-dashboard/main.js` and `bun dist/apps/term-dashboard/main.js` with a throwaway echo route; record the result in plan Validation log, then remove the route. If it fails on Bun, the CLI `serve` target runs `bun build --watch --target node` to a temp file and starts it with `node`, so dev and production share the Node path. Also confirm Nx `continuous: true` for both `serve` targets (`nx_docs` or the nx project schema) before relying on it.

## Verification
- `bun --bun nx run-many -t lint test build -p term-dashboard term-dashboard-web term-config` exits 0.
- `bun run link:td && command -v td` prints `~/.bun/bin/td`; `td --version`; `node $(readlink -f ~/.bun/bin/td) --version`; `td --no-open --port 0` prints a URL with `#c=` and `curl -s 127.0.0.1:<port>/api/health` returns the JSON; `curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:<port>/api/settings` returns 401; running `td` a second time opens the first instance and exits 0; `bun run unlink:td` leaves no `td` in `~/.bun/bin`.
- `jq '.dependencies' dist/apps/term-dashboard/package.json` prints `null`.
- Stop every `td`/vite process started during verification (process-management rule).

## Rollback
Delete the three project folders, the tsconfig path, the scripts and the added devDependencies; restore `bun.lock`.
