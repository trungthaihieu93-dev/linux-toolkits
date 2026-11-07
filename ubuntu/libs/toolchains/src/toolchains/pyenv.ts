import { addRcBlock, aptInstall } from '@linux-toolchain/core';
import { choiceList, choiceString } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { requireApt, tryAddon } from './shared';

const BUILD_DEPS = [
  'build-essential',
  'curl',
  'git',
  'libssl-dev',
  'zlib1g-dev',
  'libbz2-dev',
  'libreadline-dev',
  'libsqlite3-dev',
  'libncursesw5-dev',
  'xz-utils',
  'tk-dev',
  'libxml2-dev',
  'libxmlsec1-dev',
  'libffi-dev',
  'liblzma-dev',
];

const PYENV_INSTALL = [
  'if [ -d "$HOME/.pyenv" ]; then',
  '  export PATH="$HOME/.pyenv/bin:$PATH"',
  '  pyenv update || git -C "$HOME/.pyenv" pull --ff-only',
  'else',
  '  curl -fsSL https://pyenv.run | bash',
  'fi',
  '"$HOME/.pyenv/bin/pyenv" --version',
].join('\n');

const PYENV_RC = [
  'export PYENV_ROOT="$HOME/.pyenv"',
  '[ -d "$PYENV_ROOT/bin" ] && export PATH="$PYENV_ROOT/bin:$PATH"',
  'eval "$(pyenv init -)"',
].join('\n');

const PYENV_PATH = [
  'export PYENV_ROOT="$HOME/.pyenv"',
  'export PATH="$PYENV_ROOT/bin:$PATH"',
];

/** How many stable 3.x minors back from the newest each choice goes. */
const MINORS_BACK: Record<string, number> = {
  latest: 0,
  'latest-1': 1,
  'latest-2': 2,
};

/**
 * User script: pick the newest patch of the stable CPython 3.x minor `back`
 * minors below the newest one listed by `pyenv install --list`, install it and
 * make it the global version.
 */
function pythonScript(back: number): string {
  const want = back + 1;
  return [
    ...PYENV_PATH,
    // Only plain X.Y.Z lines: drops pre-releases (a/b/rc), -dev, free-threaded (t) and other implementations.
    "list=$(pyenv install --list | sed -n 's/^ *\\(3\\.[0-9][0-9]*\\.[0-9][0-9]*\\) *$/\\1/p' | sort -t. -k2,2n -k3,3n)",
    'minors=$(printf \'%s\\n\' "$list" | cut -d. -f1,2 | uniq)',
    'count=$(printf \'%s\\n\' "$minors" | grep -c . || true)',
    `[ "$count" -ge ${want} ] || { echo "pyenv: found $count stable CPython 3.x minor(s), need ${want}" >&2; exit 1; }`,
    `minor=$(printf '%s\\n' "$minors" | tail -n ${want} | head -n 1)`,
    `ver=$(printf '%s\\n' "$list" | awk -F. -v m="$minor" '$1 "." $2 == m' | tail -n 1)`,
    'echo "pyenv: installing Python $ver"',
    'pyenv install -s "$ver"',
    'pyenv global "$ver"',
    'pyenv version',
  ].join('\n');
}

/** pyenv.run ships pyenv-virtualenv; clone it only when an older or manual install lacks it. */
const VIRTUALENV_INSTALL = [
  'd="$HOME/.pyenv/plugins/pyenv-virtualenv"',
  '[ -d "$d" ] || git clone https://github.com/pyenv/pyenv-virtualenv.git "$d"',
  addRcBlock('pyenv-virtualenv', 'eval "$(pyenv virtualenv-init -)"'),
].join('\n');

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
      choices: [
        { value: 'pyenv-virtualenv', label: 'pyenv-virtualenv plugin' },
      ],
      default: [],
    },
  ],
  async install(ic, choices) {
    const python = choiceString(choices, 'python');
    const addons = choiceList(choices, 'addons');
    const back = MINORS_BACK[python];
    if (python !== 'none' && back === undefined)
      throw new Error(`pyenv: unsupported python choice: ${python}`);
    requireApt(ic, 'pyenv: this component');

    ic.logger.log('Installing pyenv build dependencies');
    await ic.runner.asRoot(aptInstall(BUILD_DEPS), 'pyenv: build deps');
    ic.logger.log('Installing pyenv');
    await ic.runner.asUser(PYENV_INSTALL, 'pyenv: install');
    await ic.runner.asUser(addRcBlock('pyenv', PYENV_RC), 'pyenv: shell init');

    if (back !== undefined) {
      ic.logger.log(`Installing Python (${python}) with pyenv`);
      await ic.runner.asUser(pythonScript(back), 'pyenv: python');
    }

    for (const name of addons) {
      if (name !== 'pyenv-virtualenv')
        throw new Error(`pyenv: unknown add-on: ${name}`);
      await tryAddon(ic, `pyenv: add-on ${name}`, () =>
        ic.runner.asUser(VIRTUALENV_INSTALL, `pyenv: ${name}`),
      );
    }
  },
};
