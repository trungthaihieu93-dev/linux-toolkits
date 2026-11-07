import type { Toolchain } from '../types';

/**
 * Option keys:
 * - uv     confirm install uv (astral installer, as the user)   (default true)
 * - pipx   confirm install pipx (apt)                            (default true)
 * - addons multi   ruff | poetry | pre-commit                    (default [ruff])
 *   add-ons via `uv tool install` (needs uv; warn and skip when uv=false).
 */
export const python: Toolchain = {
  id: 'python',
  label: 'Python 3 + uv + pip',
  description: 'python3, pip, venv, pipx, uv',
  options: [
    { key: 'uv', kind: 'confirm', label: 'Install uv', default: true },
    { key: 'pipx', kind: 'confirm', label: 'Install pipx', default: true },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'ruff', label: 'ruff', hint: 'uv tool install' },
        { value: 'poetry', label: 'poetry', hint: 'uv tool install' },
        { value: 'pre-commit', label: 'pre-commit', hint: 'uv tool install' },
      ],
      default: ['ruff'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
