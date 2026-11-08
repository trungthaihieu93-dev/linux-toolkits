# Phase 1 report: workspace scaffold, CLI, server shell and link

Status: done. Plan: `plans/261108-0744-term-dashboard/`. Branch `feat/term-dashboard`.

## What was built (paths under `ubuntu/`)
- `apps/term-dashboard` (`linux-term-dashboard`, bin `td`, `private`, no `dependencies`):
  - `src/cli/program.ts`: commander `td [--port <n>] [--no-open]`, hidden `--dev-origin <url>` (loopback http origins only), `--version` from package.json. Exit codes 0/1/2, and 129/130/143 after SIGHUP/SIGINT/SIGTERM.
  - `src/cli/start.ts`: refuses to start as root (`--help`/`--version` still work), reuses a running instance, binds, writes the instance file, prints and opens the launch URL, and shuts down on signals. A second signal forces exit.
  - `src/server/session.ts`: 256-bit session token and instance secret, single-use 60 s launch codes (at most 32 pending), `timingSafeEqual` on SHA-256 digests.
  - `src/server/guard.ts`: Host allowlist (`127.0.0.1:<port>`, `localhost:<port>`, dev origin), Origin check on API calls, WS Origin plus token-as-subprotocol, bearer token on `/api/*` except `GET /api/health` and `POST /api/session`. `POST /api/launch-code` takes the instance secret.
  - `src/server/app.ts`: Hono factory, health, session exchange, launch code, body limits (16 KB, or 1 MB on the routes listed in `fileContentRoutes`), and JSON 404 for `/api/*` and `/ws/*`.
  - `src/server/static.ts`: `web/` with content types, traversal protection and SPA fallback. Returns 503 when the UI is not built.
  - `src/server/listen.ts`: binds 127.0.0.1 only and maps `EADDRINUSE` to a `PortInUseError`.
  - `src/server/instance.ts`: `$XDG_RUNTIME_DIR/term-dashboard/instance.json`, falling back to `~/.local/state/term-dashboard/`. The folder is 0700 and the file 0600, written atomically. The file is trusted only when it is a regular file, owned by the current uid, mode 0600 and well formed. The pid must be alive and health must report that same pid. On exit, td removes the file only if it still holds td's own pid.
  - `src/server/cleanup.ts`: cleanup registry (runs in LIFO order, keeps going after a failure) and the SIGINT/SIGTERM/SIGHUP source.
- `apps/term-dashboard-web`: Vite 8, React 19 and Tailwind v4 placeholder. It redeems `#c=`, keeps the token in `sessionStorage`, clears the fragment and shows `/api/health`. The session promise is memoized so StrictMode cannot redeem the code twice. The `resolve.alias` entries cover `@linux-toolchain/core/shell` and `@linux-toolchain/term-config`. The dev proxy forwards `/api` and `/ws` (`ws: true`) with `changeOrigin: false`.
- `libs/term-config`: stub exporting `TERM_CONFIG_LIB`.
- `tsconfig.base.json` paths for both aliases. `package.json` has the planned devDependencies and the `dev:td`, `link:td` and `unlink:td` scripts.

## Commands and results (from the worktree's `ubuntu/`)
- `bun --bun nx run-many -t lint test build -p term-dashboard term-dashboard-web term-config` passed (term-dashboard 63 tests, web 6, term-config 1, 0 lint warnings).
- `bun --bun nx run-many -t lint test build --skip-nx-cache` passed: 16/16 tasks, including linux-toolchain, core and toolchains. `bun run lint`, `bun run test`, `bun run build` and `bun run format:check` all exit 0.
- Verification used a temporary `HOME` and `XDG_RUNTIME_DIR`. `bun run link:td` linked the package and `command -v td` printed `~/.bun/bin/td`. `td --version`, `node <main.js> --version` and `bun <main.js> --version` all print `0.1.0`. With `td --no-open --port 0` on both Node and Bun:
  - The URL contains `#c=`, health returns `{"app":"term-dashboard","version":"0.1.0","pid":N}`, `/api/settings` returns 401 and a foreign Host gets 403.
  - `ss` shows the server bound to 127.0.0.1 only. The instance folder and file are 700 and 600.
  - The code exchange returns a 43-character token, and reusing the code gets 401. No process argv contains the token.
  - A second `td` printed `td already running (pid N)` with a new URL and exited 0.
  - SIGTERM gave exit 143 and removed the instance file.
- `bun run unlink:td` removed `td` from `~/.bun/bin`. The built manifest has `dependencies: null`.
- `bun run dev:td` (temporary HOME): the Vite proxy forwarded health and session (200), and every process in the group stopped afterwards.
- No td or vite processes remain. The worktree's Nx daemon was stopped.

## Probe results (also in `plan.md` > Validation log)
- WS upgrade works on Node 26.13 and Bun 1.4.4, both bundled and from TS source under Bun, with `@hono/node-ws` and with `@hono/node-server` 2's built-in `upgradeWebSocket` + `ws`. The server selects the first offered subprotocol (`td`), so the token is not echoed back.
- Nx `continuous: true` is confirmed in the schema and in practice.

## Deviations
- **CLI build split into `bundle` + `build`.** Nx asset copying skips gitignored inputs (`dist`), and the esbuild schema rejects `includeIgnoredFiles`. So the esbuild target (identical to linux-toolchain, without the web asset) is `bundle`, and `build` is an `nx:run-commands` target that depends on `bundle` and `^build` and copies the web build into `web/`. `nx build term-dashboard` is unchanged for `link:td`, e2e and CI.
- **Web `build` runs `tsc --noEmit` before `vite build`**, so type errors fail the build. Vite alone does not type-check.
- **Extra modules** `server/session.ts`, `server/instance.ts`, `server/cleanup.ts`, `cli/start.ts` and `cli/open-browser.ts` keep `program.ts` thin and testable. There are extra specs too (`session`, `cleanup`, `program`, `start`, and a web `session.spec.ts`).
- **`xdg-open`** is launched with `execFile` and unref'd. Failures only print a warning.

## Open questions
- Should phase 3 replace the deprecated `@hono/node-ws` (peer range `^1.19.11` against 2.1.6) with `@hono/node-server`'s built-in `upgradeWebSocket` and an explicit `ws` devDependency? Both work. The library choice is the maintainer's, so it was left installed.
