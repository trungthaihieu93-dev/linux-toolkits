# toolkits

Developer machine setup for Debian/Ubuntu. The main product is
[`linux-toolchain`](./ubuntu/apps/linux-toolchain/README.md), an interactive
installer for developer toolchains published to npm.

```sh
npx linux-toolchain            # or: bunx linux-toolchain
npx linux-toolchain list       # show toolchains, options and add-ons
npx linux-toolchain --only go,cpp --defaults --dry-run
```

It needs Node.js 22.13 or newer and an apt-based distribution. The
[documentation site](https://linux-toolkits-docs.pages.dev) covers usage, how it works and every toolchain;
the [CLI README](./ubuntu/apps/linux-toolchain/README.md) is the short version.

## Repository layout

| Path                                                   | Contents                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`ubuntu/`](./ubuntu/README.md)                        | Nx workspace: the CLI app, its libraries and the original `install-toolchains.sh` |
| [`website/`](./website/README.md)                      | Documentation site (Astro + Starlight), deployed to Cloudflare Pages              |
| `.github/workflows/`                                   | CI, the docs build and deploy, and the npm publish workflow                       |
| [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md) | Guide for AI agents and contributors; `CLAUDE.md` imports `AGENTS.md`             |
| `.claude/`, `.agents/`, `.codex/`, `opencode.json`     | Configuration and skills for Claude Code, Codex and opencode                      |

## Development

```sh
cd ubuntu
bun install
bun run lint && bun run test && bun run build
bun run dev -- list                # run the CLI from TypeScript source
```

Development uses [Bun](https://bun.sh) 1.4.4 as the package manager and as
the runtime for Nx, vitest and eslint. The published package is still a single
Node.js bundle.

Docs site:

```sh
cd website
bun install
bun run dev                        # http://localhost:4321
```

Architecture, invariants, how to add a toolchain, the docs site rules and the
release procedure are in [`AGENTS.md`](./AGENTS.md).

## AI agents

Open Claude Code, Codex or opencode in the repository root. Each one reads
`AGENTS.md` and gets these skills: obra
[superpowers](https://github.com/obra/superpowers), the Nx skills and MCP
server, and the repo's `shell-scripting` skill. Setup per agent is described in
`AGENTS.md` under "Skills and agent configuration".
