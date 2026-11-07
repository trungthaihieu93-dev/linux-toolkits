# toolkits

Developer machine setup for Debian/Ubuntu. The main product is
[`linux-toolchain`](./ubuntu/apps/linux-toolchain/README.md), an interactive
installer for developer toolchains published to npm.

```sh
npx linux-toolchain            # or: bunx linux-toolchain
npx linux-toolchain list       # show toolchains, options and add-ons
npx linux-toolchain --only go,cpp --defaults --dry-run
```

It needs Node.js 22.13 or newer and an apt-based distribution. See the
[CLI README](./ubuntu/apps/linux-toolchain/README.md) for every flag and
toolchain.

## Repository layout

| Path                                                   | Contents                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`ubuntu/`](./ubuntu/README.md)                        | Nx workspace: the CLI app, its libraries and the original `install-toolchains.sh` |
| `.github/workflows/`                                   | CI (lint, test, build, real install smoke test) and the npm publish workflow      |
| [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md) | Guide for AI agents and contributors; `CLAUDE.md` imports `AGENTS.md`             |
| `.claude/`, `.agents/`, `.codex/`, `opencode.json`     | Configuration and skills for Claude Code, Codex and opencode                      |

## Development

```sh
cd ubuntu
npm ci
npx nx run-many -t lint test build
```

Architecture, invariants, how to add a toolchain and the release procedure are
in [`AGENTS.md`](./AGENTS.md).

## AI agents

Open Claude Code, Codex or opencode in the repository root. Each one reads
`AGENTS.md` and gets these skills: obra
[superpowers](https://github.com/obra/superpowers), the Nx skills and MCP
server, and the repo's `shell-scripting` skill. Setup per agent is described in
`AGENTS.md` under "Skills and agent configuration".
