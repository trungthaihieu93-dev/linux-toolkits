# ubuntu

Nx workspace for the `linux-toolchain` CLI, a TypeScript port of
[`install-toolchains.sh`](./install-toolchains.sh).

| Path                    | Purpose                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `apps/linux-toolchain`  | CLI entry point, bundled into a single ESM file and published to npm as `linux-toolchain` |
| `libs/core`             | `@linux-toolchain/core`: system helpers (bundled, not published)                          |
| `libs/toolchains`       | `@linux-toolchain/toolchains`: toolchain catalog and installers (bundled, not published)  |
| `install-toolchains.sh` | Original bash installer, kept as the reference implementation                             |

## Commands

Run from this directory:

```sh
bun install
bun run lint            # bun --bun nx run-many -t lint
bun run test            # bun --bun nx run-many -t test
bun run build           # bun --bun nx run-many -t build
bun run e2e             # builds, then runs the bundle
bun run format:check    # prettier; fix with bun run format
bun run dev -- --help   # the CLI from TypeScript source, no build
```

Bun (`packageManager` in `package.json`, lockfile `bun.lock`) installs the
dependencies and runs Nx, vitest and eslint. The published package is still a
Node.js bundle (Node 22.13 or newer).

The build output in `dist/apps/linux-toolchain/` is the publishable package:
`main.js` (third-party dependencies inlined), `package.json` and `README.md`.

Architecture, invariants and the release procedure are in the repository
root [`AGENTS.md`](../AGENTS.md).
