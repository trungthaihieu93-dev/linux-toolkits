# Phase 6 report: E2E, CI and docs

Date: 2026-11-08 (Asia/Saigon). Branch `feat/term-dashboard` (not pushed). Refs #13.

## Commits

- `eb749d4` fix(term-dashboard): read Ghostty files after its first-run template exists
- `c1fe302` test(term-dashboard): add an end-to-end suite for the built bundle
- `00ee6af` ci: test and pack term-dashboard without releasing it
- `a5119c9` docs: document term-dashboard usage, safety model and maintenance

## E2E (`ubuntu/apps/term-dashboard/e2e/td.e2e.ts`)

The `term-dashboard:e2e` target (`dependsOn: build`, config `vitest.e2e.config.mts`) runs the built `dist/apps/term-dashboard/main.js` with the current runtime. Each run uses a `createSandbox` HOME with every XDG folder inside it and `GSETTINGS_BACKEND=keyfile`, does not set DISPLAY or WAYLAND_DISPLAY (the spec asserts this), and passes `--no-open --port 0`. The suite reuses `src/testing/sandbox.ts` and `pty-client.ts`. Cases (15):

| Case | How |
|---|---|
| health | `{app, version from the built package.json, pid === child pid}` |
| loopback only | printed origin is `http://127.0.0.1:<port>`; `ss -ltnH` shows exactly `127.0.0.1:<port>` for the port; a parallel TCP connect to every non-internal, non-link-local address of the host is not accepted |
| launch code once | startup code reused gives 401; a code minted with the 0600 instance file's secret redeems once (200, same token) and then 401 |
| 401 | no token and a wrong token on `/api/inventory`; the right token gives 200 |
| 403 | foreign `Host` (raw `node:http`) on `/api/health` and `/`; foreign `Origin` on an authorised API call; foreign Origin on the WS handshake |
| static | `index.html` (text/html) and the hashed `/assets/*-<8>.js` it references (javascript) |
| zsh Config save (skipIf no zsh) | `zsh -n` check ok; file minus the managed block equals the original; alias in the block; backup equals the original, mode 0600 |
| bash Config save | the same checks with `bash -n` |
| activity stream | SSE on `/api/activity`; after a bash save, a `started` event (`bash -n`, ts after the save started) and its `exited` event with code 0 |
| PTY | `/ws/pty` with `/bin/sh`, `echo td-ok` comes back |
| Ghostty (skipIf no ghostty / not installed per inventory) | `font-size = 13` saved through `ghostty +validate-config` into the sandbox |
| Ptyxis (skipIf no gsettings or no Ptyxis schema / none in inventory) | flips a boolean global key; the response and the sandbox keyfile show it |
| second start | second td exits 0, prints `td already running (pid <first>)` and a URL on the first port, no `listening on`; its code redeems on the first server; the instance file still names the first pid and port |
| SIGTERM / SIGHUP | with `sleep 300 &` in a PTY: exit 143 / 129; every recorded descendant (script, shell, sleep) is gone, `pgrep -s <sid>` is empty, the instance file is removed |

Root refusal is already covered by `src/cli/start.spec.ts` ("refuses to start as root"); no new spec was added.

Runs:

- Bun: `NX_DAEMON=false bun --bun nx run term-dashboard:e2e` gives 15/15 passed, none skipped (zsh, ghostty, gsettings + Ptyxis schema, script/setpriv, ss are all installed here).
- Node: `node node_modules/vitest/vitest.mjs run --config apps/term-dashboard/vitest.e2e.config.mts` from `ubuntu/` (vitest on Node v26.13.0, so the bundle is spawned with `node`) gives 15/15 passed. nvm has only 26.13 locally; 22.13 and 24 are covered by CI node-compat.

## Defect found and fixed

`GhosttyService.config()` read both Ghostty files and then ran `ghostty +show-config`. Ghostty 1.4 (verified locally in a scratch HOME) writes a template `config.ghostty` when no config file exists, so the view reported `exists: false, mtimeMs: null`. The first save from a freshly loaded Ghostty page on a machine without a Ghostty config therefore got 409 "changed on disk". The fix runs the CLI (schema, effective config) before reading the files. A new unit spec (`reads the files after Ghostty has written its first-run template`) fails without the fix and passes with it.

## CI (`.github/workflows/ci.yml`)

- `checks`: installs zsh (`sudo apt-get update -q && sudo apt-get install -y -q zsh`) before lint/test/build/e2e; after the linux-toolchain artifact, builds td, asserts `private` is true, packs it into `$RUNNER_TEMP/td-package` and uploads the **separate** artifact `td-package`. The `package` artifact (which the release job requires to hold exactly one tgz) is untouched.
- `node-compat` (22.13.0, 24): downloads `td-package`, extracts it into `td/`, runs `node td/package/main.js --version`, then a sandboxed health check: start with temp HOME/XDG and keyfile, DISPLAY/WAYLAND unset, `--no-open --port 0`; wait for `listening on`; `curl /api/health` and check app and pid; SIGTERM and expect 143. The log is printed with the launch code redacted on failure, and a trap removes the sandbox.
- `smoke` (root, ubuntu:24.04): downloads `td-package` and runs `npx --yes ./linux-term-dashboard-*.tgz --version` and `--help` only.
- `release`: unchanged. `diff <(git show main:.github/workflows/ci.yml | sed -n '/^  release:/,$p') <(sed -n '/^  release:/,$p' ci.yml)` is empty. It now also waits for the extended node-compat and smoke jobs through its existing `needs`.
- actionlint is not installed, and fetching it (`go run …/actionlint@v1.7.7`) was denied by the session's permission classifier, so actionlint was **not run**. Substitutes: the YAML parses (`Bun.YAML.parse`, 4 jobs with the expected `needs`); every new `run:` block passes `bash -n` (shellcheck is not installed either); and the node-compat extract/version/health steps and the smoke npx step were run locally, verbatim, against a freshly packed tarball (all passed, td stopped with 143, no sandbox left). The workflow has not run on GitHub yet because nothing was pushed.

## Package checks

- `npm pack --dry-run` in `dist/apps/term-dashboard` lists `LICENSE`, `README.md`, `main.js`, `package.json`, `web/index.html` and 61 files under `web/assets/`. `jq .private package.json` gives `true`, and `dependencies` is empty.
- `npm pack` works on the private package, and `npx --yes ./linux-term-dashboard-0.1.0.tgz --version` / `--help` run (0.1.0 / usage).

## Docs

- `ubuntu/apps/term-dashboard/README.md`: features, install (npx/bunx/global once published; link from source until then), flags checked against `node main.js --help` (`--port`, `--no-open`, `-v`, `-h`; the hidden `--dev-origin` appears only under local development), exit codes, the safety model, backups and restore (UI and by hand), `dev:td` / `link:td` / `unlink:td` checked against `ubuntu/package.json`, the sandboxed testing env vars, and maintainer notes for the release follow-up (remove `private`, add the tarball to release, publish once, then trusted publishing).
- `AGENTS.md`: a purpose paragraph, three layout rows, commands (`dev:td`, `link:td`/`unlink:td`, `nx test term-config`), the two-step td build, td architecture bullets (CommandRunner + ActivityBus, FileStore pipeline, services and guard, PTY via `script`, web), td invariants, and a release note that td is private. README behaviour is linked, not restated.
- Root `README.md` and `ubuntu/README.md`: td mention, layout rows and commands.

## Final gates (from `ubuntu/`, `NX_DAEMON=false`)

| Command | Exit |
|---|---|
| `bun run lint` | 0 |
| `bun run test` | 0 |
| `bun run build` | 0 |
| `bun run e2e` (linux-toolchain and term-dashboard) | 0 |
| `bun run format:check` | 0 |

Root-level `AGENTS.md`, `README.md` and `ci.yml` are outside the Nx workspace; `prettier --check` with `ubuntu/.prettierrc` passes for them.

## Real-environment safety

Taken before any td run and again after everything: `sha256sum ~/.zshrc ~/.bashrc ~/.config/ghostty/config*` plus `gsettings list-recursively org.gnome.Ptyxis | sha256sum` (read-only, without the `dconf` CLI). They are identical (5 of 5 entries). No td, `script -qfec` or vitest process is left, no `/tmp/td-e2e-*` sandbox remains, and the scratch probe folders were removed. The unrelated Playwright Chrome was not touched.

## Deviations

- **Runtime for the bundle.** The suite spawns the bundle with `process.execPath`, like the linux-toolchain e2e, instead of a hard-coded `node`. `bun run e2e` therefore runs it on Bun and the Node vitest run runs it on Node, which together cover both runtimes the success criteria name. CI node-compat runs it on Node 22.13 and 24.
- **The e2e also covers Ghostty and Ptyxis saves.** The spec only said they skip when missing; minimal save cases were added so the skips mean something.
- **Link-local IPv6 addresses** are left out of the non-loopback connect probe (they need a scope id and only time out).

## Unresolved questions

- The CI changes have not run on GitHub (no push). The first PR run should confirm the `apt-get install zsh` step, the `td-package` artifact and the node-compat health check on 22.13.
- actionlint was not run (see CI). Run it locally or in CI before merging if wanted.
