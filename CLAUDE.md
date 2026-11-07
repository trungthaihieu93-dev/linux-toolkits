@AGENTS.md

## Claude Code notes

- `.claude/settings.json` enables two plugins: `superpowers@claude-plugins-official`
  (official marketplace) and `nx@nx-claude-plugins` (marketplace
  `nrwl/nx-ai-agents-config`, which provides the Nx MCP server, skills and
  agents). Accept the install prompt the first time you open this repository.
- Start Claude Code in the repository root so `.claude/settings.json` is
  loaded. Run Nx commands from `ubuntu/`.
- The Nx guidelines live in the block at the end of `AGENTS.md`, not here, so
  they exist once.
- The repo-authored `shell-scripting` skill is in `.claude/skills/`.
