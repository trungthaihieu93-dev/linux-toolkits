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
  async install() {
    throw new Error('not implemented');
  },
};
