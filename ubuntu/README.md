# ubuntu

Nx workspace for the `linux-toolchain` CLI, a TypeScript port of
[`install-toolchains.sh`](./install-toolchains.sh), and for
[`td`](./apps/term-dashboard/README.md), a local web dashboard for terminal and
shell configuration (private, not published yet).

| Path                      | Purpose                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/linux-toolchain`    | CLI entry point, bundled into a single ESM file and published to npm as `linux-toolchain`    |
| `apps/term-dashboard`     | `td` CLI and server, bundled into a single ESM file plus the web UI in `web/`                |
| `apps/term-dashboard-web` | td's dashboard (Vite + React), served by `td`                                                |
| `libs/core`               | `@linux-toolchain/core`: system helpers (bundled, not published)                             |
| `libs/toolchains`         | `@linux-toolchain/toolchains`: toolchain catalog and installers (bundled, not published)     |
| `libs/term-config`        | `@linux-toolchain/term-config`: td's API contract and config codecs (bundled, not published) |
| `install-toolchains.sh`   | Original bash installer, kept as the reference implementation                                |

## Commands

Run from this directory:

```sh
bun install
bun run lint            # bun --bun nx run-many -t lint
bun run test            # bun --bun nx run-many -t test
bun run build           # bun --bun nx run-many -t build
bun run e2e             # builds, then runs the bundles
bun run format:check    # prettier; fix with bun run format
bun run dev -- --help   # the CLI from TypeScript source, no build
bun run dev:td          # td from source plus the Vite dev server
bun run link:td         # build td and link it as `td`; bun run unlink:td undoes it
```

Bun (`packageManager` in `package.json`, lockfile `bun.lock`) installs the
dependencies and runs Nx, vitest and eslint. The published package is still a
Node.js bundle (Node 22.13 or newer).

The build output in `dist/apps/linux-toolchain/` is the publishable package:
`main.js` (third-party dependencies inlined), `package.json`, `README.md` and
`LICENSE`. td's build output in `dist/apps/term-dashboard/` has the same files
plus `web/`.

Architecture, invariants and the release procedure are in the repository
root [`AGENTS.md`](../AGENTS.md).
