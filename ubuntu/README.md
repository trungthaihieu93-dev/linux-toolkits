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
npm ci
npm run lint     # nx run-many -t lint
npm run test     # nx run-many -t test
npm run build    # nx run-many -t build
node dist/apps/linux-toolchain/main.js --help
```

The build output in `dist/apps/linux-toolchain/` is the publishable package:
`main.js` (third-party dependencies inlined), `package.json` and `README.md`.

Architecture, invariants and the release procedure are in the repository
root [`AGENTS.md`](../AGENTS.md).
