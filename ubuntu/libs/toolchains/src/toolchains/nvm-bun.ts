import type { Toolchain } from '../types';

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
        { value: 'lts-prev', label: 'Previous LTS' },
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
        { value: 'typescript', label: 'typescript + tsx', hint: 'global npm packages' },
      ],
      default: ['pnpm', 'typescript'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
