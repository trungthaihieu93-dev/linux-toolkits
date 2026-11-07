import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  rootScript,
  userScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { pyenv } from './pyenv';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const noFetch = (() =>
  Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch;
const ALL: Choices = { python: 'latest-2', addons: ['pyenv-virtualenv'] };

function run(
  overrides: Choices = {},
  opts: { fail?: string[]; apt?: boolean } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const apt = opts.apt ?? true;
  const ic = createInstallContext({
    runner,
    ctx,
    logger,
    fetch: noFetch,
    exists: (p) => apt && p === '/usr/bin/apt-get',
    listDir: () => [],
  });
  return {
    runner,
    ic,
    done: pyenv.install(ic, mergeChoices(defaultsFor(pyenv), overrides)),
  };
}

/** Shaped like `pyenv install --list` output, deliberately out of order. */
const PYENV_LIST = [
  'Available versions:',
  '  2.7.18',
  '  3.11.9',
  '  3.11.14',
  '  3.12.12',
  '  3.13.2',
  '  3.13.10',
  '  3.13.10t',
  '  3.14.0',
  '  3.14.1',
  '  3.15.0a1',
  '  3.15-dev',
  '  pypy3.10-7.3.17',
];

/** Run the resolution script with a stub `pyenv` that records install/global. */
function resolveWith(script: string, list: string[]) {
  const stub = [
    'pyenv() {',
    '  case "$1" in',
    `    install) if [ "$2" = --list ]; then printf '%s\\n' ${list.map((l) => `'${l}'`).join(' ')}; else echo "install $*"; fi ;;`,
    '    *) echo "$*" ;;',
    '  esac',
    '}',
  ].join('\n');
  return spawnSync('bash', ['-c', `set -e\n${stub}\n${script}`], {
    encoding: 'utf8',
  });
}

describe('pyenv install', () => {
  it('defaults: build deps, pyenv, rc block (bash parity), then latest Python as global', async () => {
    const { runner, ic, done } = run();
    await done;
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'pyenv: build deps'],
      ['user', 'pyenv: install'],
      ['user', 'pyenv: shell init'],
      ['user', 'pyenv: python'],
    ]);
    const [deps, install, rc, py] = runner.calls.map((c) => c.script);
    expect(deps).toContain(
      "'build-essential' 'curl' 'git' 'libssl-dev' 'zlib1g-dev'",
    );
    expect(deps).toContain("'libffi-dev' 'liblzma-dev'");
    expect(install).toContain(
      'pyenv update || git -C "$HOME/.pyenv" pull --ff-only',
    );
    expect(install).toContain('curl -fsSL https://pyenv.run | bash');
    expect(rc).toContain("'# >>> pyenv >>>'");
    expect(rc).toContain('eval "$(pyenv init -)"');
    expect(rc).not.toContain('grep -qE');
    expect(py).toContain('pyenv install --list');
    expect(py).toContain('pyenv install -s "$ver"');
    expect(py).toContain('pyenv global "$ver"');
    expect(ic.warnings).toEqual([]);
  });

  it('all options: two minors back plus pyenv-virtualenv with its rc block', async () => {
    const { runner, done } = run(ALL);
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'pyenv: build deps',
      'pyenv: install',
      'pyenv: shell init',
      'pyenv: python',
      'pyenv: pyenv-virtualenv',
    ]);
    const venv = runner.calls[4]?.script ?? '';
    expect(venv).toContain(
      '[ -d "$d" ] || git clone https://github.com/pyenv/pyenv-virtualenv.git "$d"',
    );
    expect(venv).toContain("'# >>> pyenv-virtualenv >>>'");
    expect(venv).toContain('eval "$(pyenv virtualenv-init -)"');
  });

  it('python=none installs only pyenv', async () => {
    const { runner, done } = run({ python: 'none' });
    await done;
    expect(runner.calls.map((c) => c.label)).not.toContain('pyenv: python');
  });

  it('an add-on failure becomes a warning and the install still resolves', async () => {
    const { ic, done } = run(ALL, { fail: ['pyenv: pyenv-virtualenv'] });
    await expect(done).resolves.toBeUndefined();
    expect(ic.warnings).toEqual([
      expect.stringMatching(/^pyenv: add-on pyenv-virtualenv failed: /),
    ]);
  });

  it('needs apt', async () => {
    const { runner, done } = run({}, { apt: false });
    await expect(done).rejects.toThrow(
      'pyenv: this component needs apt (Debian/Ubuntu)',
    );
    expect(runner.calls).toEqual([]);
  });

  it('a failed Python build rejects', async () => {
    const { done } = run({}, { fail: ['pyenv: python'] });
    await expect(done).rejects.toThrow('pyenv: python');
  });

  it.skipIf(!hasBash)('every script parses with bash -n', async () => {
    const { runner, done } = run(ALL);
    await done;
    for (const call of runner.calls) {
      const res = spawnSync('bash', ['-n'], {
        input:
          call.as === 'root'
            ? rootScript(call.script)
            : userScript(call.script),
      });
      expect(res.status, `${call.label}: ${res.stderr}`).toBe(0);
    }
  });

  it.skipIf(!hasBash)(
    'resolves the newest patch of the newest stable minors',
    async () => {
      const expected: Record<string, string> = {
        latest: '3.14.1',
        'latest-1': '3.13.10',
        'latest-2': '3.12.12',
      };
      for (const [choice, version] of Object.entries(expected)) {
        const { runner, done } = run({ python: choice, addons: [] });
        await done;
        const res = resolveWith(runner.calls[3]?.script ?? '', PYENV_LIST);
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toContain(
          `install install -s ${version}\nglobal ${version}`,
        );
      }
    },
  );

  it.skipIf(!hasBash)(
    'fails clearly when there are not enough stable minors',
    async () => {
      const { runner, done } = run({ python: 'latest-2', addons: [] });
      await done;
      const res = resolveWith(runner.calls[3]?.script ?? '', [
        'Available versions:',
        '  3.14.1',
        '  3.13.2',
      ]);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain(
        'found 2 stable CPython 3.x minor(s), need 3',
      );
      expect(res.stdout).not.toContain('install -s');
    },
  );
});
