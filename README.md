# toolkits

Developer machine setup for Debian/Ubuntu. The main product is
[`linux-toolchain`](./ubuntu/apps/linux-toolchain/README.md), an interactive
installer for developer toolchains published to npm. The same workspace
holds [`td`](./ubuntu/apps/term-dashboard/README.md) (`linux-term-dashboard`),
a local web dashboard for terminal and shell configuration; it is not
published yet.

### Prerequisites

An apt-based distribution (Debian, Ubuntu or a derivative), a user that can
run `sudo`, and **Node.js 22.13 or newer** (for `npx`) **or bun** (for
`bunx`). A fresh system has neither runtime, so install one first, as your
normal user. Do not use apt's `nodejs` package: it is usually older than
22.13.

```sh
sudo apt-get update && sudo apt-get install -y curl unzip ca-certificates

# Option A: Node.js with nvm (https://github.com/nvm-sh/nvm#installing-and-updating)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install --lts && nvm alias default 'lts/*'
node --version                 # v22.13.0 or newer

# Option B: bun (https://bun.sh/docs/installation)
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Other Node.js install methods: <https://nodejs.org/en/download>. The
[Prerequisites page](https://linux-toolkits-docs.pages.dev/ubuntu/prerequisites/)
has the step-by-step version.

### Run

```sh
npx linux-toolchain            # or: bunx linux-toolchain
npx linux-toolchain list       # show toolchains, options and add-ons
npx linux-toolchain --only go,cpp --defaults --dry-run
```

The [documentation site](https://linux-toolkits-docs.pages.dev) covers usage, how it works and every toolchain;
the [CLI README](./ubuntu/apps/linux-toolchain/README.md) is the short version.

## Repository layout

| Path                                                   | Contents                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`ubuntu/`](./ubuntu/README.md)                        | Nx workspace: the CLI apps, their libraries and the original `install-toolchains.sh` |
| [`website/`](./website/README.md)                      | Documentation site (Astro + Starlight), deployed to Cloudflare Pages                 |
| `.github/workflows/`                                   | CI, the docs build and deploy, and the npm publish workflow                          |
| [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md) | Guide for AI agents and contributors; `CLAUDE.md` imports `AGENTS.md`                |
| `.claude/`, `.agents/`, `.codex/`, `opencode.json`     | Configuration and skills for Claude Code, Codex and opencode                         |

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
