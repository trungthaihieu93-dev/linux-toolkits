import { shQuote } from '@linux-toolchain/core';
import { choiceList } from '../options';
import type { Toolchain } from '../types';

/**
 * Option keys:
 * - packages multi nx | turbo | expo | @nestjs/cli | @angular/cli | opencode-ai |
 *                  @openai/codex | cline | @kilocode/cli   (default: all)
 * No add-ons: the package list is the choice. Installed with `bun add -g <pkg>@latest`.
 */
export const BUN_TOOL_PACKAGES = [
  'nx',
  'turbo',
  'expo',
  '@nestjs/cli',
  '@angular/cli',
  'opencode-ai',
  '@openai/codex',
  'cline',
  '@kilocode/cli',
] as const;

export const bunTools: Toolchain = {
  id: 'bun-tools',
  label: 'Bun-based CLIs',
  description: 'nx turbo expo nest angular opencode codex cline kilocode',
  requires: ['nvm-bun'],
  options: [
    {
      key: 'packages',
      kind: 'multi',
      label: 'Global CLIs',
      choices: BUN_TOOL_PACKAGES.map((p) => ({ value: p, label: p })),
      default: [...BUN_TOOL_PACKAGES],
    },
  ],
  async install(ic, choices) {
    const packages = choiceList(choices, 'packages');
    if (packages.length === 0) {
      ic.logger.log('bun-tools: no packages selected, nothing to install');
      return;
    }
    ic.logger.log('Installing global CLIs with bun');
    await ic.runner.asUser(
      [
        'command -v bun >/dev/null || { echo "bun not found; select nvm-bun first" >&2; exit 1; }',
        'failed=""',
        `for p in ${packages.map(shQuote).join(' ')}; do`,
        '  echo "--> bun add -g $p@latest"',
        '  bun add -g "$p@latest" </dev/null || failed="$failed $p"',
        'done',
        '# let packages that download platform binaries in postinstall do so',
        'bun pm -g trust --all </dev/null >/dev/null 2>&1 || true',
        '[ -z "$failed" ] || { echo "FAILED packages:$failed" >&2; exit 1; }',
      ].join('\n'),
      'bun-tools: bun add -g',
    );
  },
};
