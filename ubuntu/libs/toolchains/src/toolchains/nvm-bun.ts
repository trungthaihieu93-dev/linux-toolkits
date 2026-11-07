import { addRcBlock } from '@linux-toolchain/core';
import { choiceBool, choiceList, choiceString } from '../options';
import type { Toolchain } from '../types';
import { tryAddon } from './shared';

/** Pinned nvm tag used when the GitHub API lookup fails (same as the bash script). */
const NVM_FALLBACK_TAG = 'v0.40.3';

/** Shell lines that install a Node.js version with nvm and make it the default. */
const NODE_INSTALL: Record<string, string[]> = {
  lts: ['nvm install --lts', "nvm alias default 'lts/*'"],
  current: ['nvm install node', 'nvm alias default node'],
  // Newest LTS major below the current LTS major, e.g. 22 while 24 is the active LTS.
  'lts-prev': [
    "majors=$(nvm ls-remote --lts --no-colors | sed -n 's/^[^v]*v\\([0-9][0-9]*\\)\\.[0-9][0-9]*\\.[0-9][0-9]*.*/\\1/p' | sort -un)",
    'count=$(printf \'%s\\n\' "$majors" | grep -c . || true)',
    '[ "$count" -ge 2 ] || { echo "could not determine the previous Node LTS from nvm ls-remote --lts" >&2; exit 1; }',
    'prev=$(printf \'%s\\n\' "$majors" | tail -n 2 | head -n 1)',
    'echo "previous Node LTS: v$prev"',
    'nvm install "$prev"',
    'nvm alias default "$prev"',
  ],
};

const NVM_RC = [
  'export NVM_DIR="$HOME/.nvm"',
  '[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"',
  '[ -s "$NVM_DIR/bash_completion" ] && \\. "$NVM_DIR/bash_completion"',
].join('\n');

const BUN_RC = [
  'export BUN_INSTALL="$HOME/.bun"',
  'export PATH="$BUN_INSTALL/bin:$PATH"',
].join('\n');

/** Corepack ships with Node up to 24 only; install it from npm when it is missing. */
function corepackScript(tool: 'pnpm' | 'yarn'): string {
  return [
    'command -v corepack >/dev/null 2>&1 || npm install -g corepack',
    `corepack enable ${tool}`,
    `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 ${tool} --version`,
  ].join('\n');
}

const ADDON_SCRIPTS: Record<string, string> = {
  pnpm: corepackScript('pnpm'),
  yarn: corepackScript('yarn'),
  typescript: [
    'npm install -g typescript tsx',
    'tsc --version',
    'tsx --version',
  ].join('\n'),
};

/**
 * Option keys:
 * - node   select  lts | current | lts-prev        (default lts)
 * - bun    confirm install bun                      (default true)
 * - addons multi   pnpm | yarn | typescript         (default [pnpm, typescript])
 *   pnpm/yarn via corepack; typescript = global typescript + tsx.
 */
export const nvmBun: Toolchain = {
  id: 'nvm-bun',
  label: 'nvm + bun + Node LTS',
  description: 'latest nvm & bun, then nvm installs the latest Node LTS',
  isPresent: (p) => p.exists(`${p.ctx.home}/.bun/bin/bun`),
  options: [
    {
      key: 'node',
      kind: 'select',
      label: 'Node.js version',
      choices: [
        { value: 'lts', label: 'Latest LTS', hint: 'nvm install --lts' },
        { value: 'current', label: 'Current', hint: 'nvm install node' },
        {
          value: 'lts-prev',
          label: 'Previous LTS',
          hint: 'newest release of the LTS line before the latest',
        },
      ],
      default: 'lts',
    },
    { key: 'bun', kind: 'confirm', label: 'Install bun', default: true },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'pnpm', label: 'pnpm', hint: 'corepack' },
        { value: 'yarn', label: 'yarn', hint: 'corepack' },
        {
          value: 'typescript',
          label: 'typescript + tsx',
          hint: 'global npm packages',
        },
      ],
      default: ['pnpm', 'typescript'],
    },
  ],
  async install(ic, choices) {
    const node = choiceString(choices, 'node');
    const withBun = choiceBool(choices, 'bun');
    const addons = choiceList(choices, 'addons');
    const nodeLines = NODE_INSTALL[node];
    if (!nodeLines)
      throw new Error(`nvm-bun: unsupported node choice: ${node}`);

    if (withBun) {
      ic.logger.log('Installing bun (latest)');
      await ic.runner.asUser(
        'curl -fsSL https://bun.sh/install | bash',
        'nvm-bun: bun',
      );
    }

    ic.logger.log(`Installing nvm (latest) and Node ${node}`);
    await ic.runner.asUser(
      [
        'tag=$(curl -fsSL https://api.github.com/repos/nvm-sh/nvm/releases/latest \\',
        `  | sed -n 's/.*"tag_name": *"\\([^"]*\\)".*/\\1/p' | head -n1)`,
        `[ -n "$tag" ] || tag=${NVM_FALLBACK_TAG}`,
        'echo "nvm $tag"',
        'curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$tag/install.sh" | bash',
        'export NVM_DIR="$HOME/.nvm"',
        'set +e; . "$NVM_DIR/nvm.sh"; set -e',
        ...nodeLines,
        withBun ? 'node --version; bun --version' : 'node --version',
      ].join('\n'),
      'nvm-bun: nvm + node',
    );

    // The installers pick one rc file from $SHELL (or none); make sure bash and zsh both load them.
    const rc = [addRcBlock('nvm', NVM_RC, 'NVM_DIR')];
    if (withBun) rc.push(addRcBlock('bun', BUN_RC, 'BUN_INSTALL|\\.bun/bin'));
    await ic.runner.asUser(rc.join('\n'), 'nvm-bun: shell init');

    for (const name of addons) {
      const script = ADDON_SCRIPTS[name];
      if (!script) throw new Error(`nvm-bun: unknown add-on: ${name}`);
      await tryAddon(ic, `nvm-bun: add-on ${name}`, () =>
        ic.runner.asUser(script, `nvm-bun: ${name}`),
      );
    }
  },
};
