import { aptInstall, shQuote } from '@linux-toolchain/core';
import { choiceBool, choiceList } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { requireApt, tryAddon } from './shared';

const APT_PACKAGES = [
  'python3',
  'python3-pip',
  'python3-venv',
  'python3-dev',
  'python3-setuptools',
  'python3-wheel',
  'python-is-python3',
  'pipx',
  'build-essential',
  'libffi-dev',
  'libssl-dev',
];

/**
 * Option keys:
 * - uv     confirm install uv (astral installer, as the user)   (default true)
 * - pipx   confirm install pipx (apt)                            (default true)
 * - addons multi   ruff | poetry | pre-commit                    (default [ruff])
 *   add-ons via `uv tool install`; with uv=false via `pipx install`; warned and skipped when neither.
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
        {
          value: 'ruff',
          label: 'ruff',
          hint: 'uv tool install (pipx without uv)',
        },
        {
          value: 'poetry',
          label: 'poetry',
          hint: 'uv tool install (pipx without uv)',
        },
        {
          value: 'pre-commit',
          label: 'pre-commit',
          hint: 'uv tool install (pipx without uv)',
        },
      ],
      default: ['ruff'],
    },
  ],
  async install(ic, choices) {
    const withUv = choiceBool(choices, 'uv');
    const withPipx = choiceBool(choices, 'pipx');
    const addons = choiceList(choices, 'addons');
    requireApt(ic, 'python: this component');

    ic.logger.log('Installing Python 3 toolchain');
    await ic.runner.asRoot(
      [
        aptInstall(
          withPipx ? APT_PACKAGES : APT_PACKAGES.filter((p) => p !== 'pipx'),
        ),
        '# Debian/Ubuntu only ship pip3; provide the plain `pip` name too',
        'if ! command -v pip >/dev/null && command -v pip3 >/dev/null; then',
        '  ln -s "$(command -v pip3)" /usr/local/bin/pip',
        'fi',
        'python3 --version; pip --version',
      ].join('\n'),
      'python: apt packages',
    );

    if (withUv) {
      ic.logger.log('Installing uv (latest)');
      await ic.runner.asUser(
        'curl -LsSf https://astral.sh/uv/install.sh | sh; uv --version',
        'python: uv',
      );
    }

    if (addons.length === 0) return;
    const installer = withUv
      ? 'uv tool install'
      : withPipx
        ? 'pipx install'
        : undefined;
    if (!installer) {
      ic.warn(
        `python: add-ons skipped (${addons.join(', ')}): they need uv or pipx`,
      );
      return;
    }
    for (const name of addons) {
      await tryAddon(ic, `python: add-on ${name}`, () =>
        ic.runner.asUser(`${installer} ${shQuote(name)}`, `python: ${name}`),
      );
    }
  },
};
