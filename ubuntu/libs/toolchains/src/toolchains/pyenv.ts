import type { Toolchain } from '../types';

/**
 * Option keys:
 * - python select none | latest | latest-1 | latest-2   (default latest)
 *   CPython to install and set global via pyenv, picked from `pyenv install --list`:
 *   latest = newest stable 3.x, latest-1 / latest-2 = newest patch of the previous minors.
 * - addons multi  pyenv-virtualenv                       (default [])
 */
export const pyenv: Toolchain = {
  id: 'pyenv',
  label: 'pyenv',
  description: 'pyenv + build deps, shell init in ~/.bashrc and ~/.zshrc',
  options: [
    {
      key: 'python',
      kind: 'select',
      label: 'Python to install with pyenv',
      choices: [
        { value: 'none', label: 'None', hint: 'pyenv only' },
        { value: 'latest', label: 'Latest 3.x' },
        { value: 'latest-1', label: 'Previous 3.x minor' },
        { value: 'latest-2', label: 'Two 3.x minors back' },
      ],
      default: 'latest',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [{ value: 'pyenv-virtualenv', label: 'pyenv-virtualenv plugin' }],
      default: [],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
