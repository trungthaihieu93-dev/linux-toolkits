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
import { python } from './python';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const noFetch = (() =>
  Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch;
const ALL: Choices = {
  uv: true,
  pipx: true,
  addons: ['ruff', 'poetry', 'pre-commit'],
};

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
    done: python.install(ic, mergeChoices(defaultsFor(python), overrides)),
  };
}

describe('python install', () => {
  it('defaults: apt packages incl. pipx, pip link, uv, ruff via uv (bash parity)', async () => {
    const { runner, ic, done } = run();
    await done;
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'python: apt packages'],
      ['user', 'python: uv'],
      ['user', 'python: ruff'],
    ]);
    const [apt, uv, ruff] = runner.calls.map((c) => c.script);
    expect(apt).toContain("'python3' 'python3-pip' 'python3-venv'");
    expect(apt).toContain("'python-is-python3' 'pipx' 'build-essential'");
    expect(apt).toContain('ln -s "$(command -v pip3)" /usr/local/bin/pip');
    expect(apt).toContain('python3 --version; pip --version');
    expect(uv).toBe(
      'curl -LsSf https://astral.sh/uv/install.sh | sh; uv --version',
    );
    expect(ruff).toBe("uv tool install 'ruff'");
    expect(ic.warnings).toEqual([]);
  });

  it('all options: every add-on via uv', async () => {
    const { runner, done } = run(ALL);
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'python: apt packages',
      'python: uv',
      'python: ruff',
      'python: poetry',
      'python: pre-commit',
    ]);
    expect(runner.calls[4]?.script).toBe("uv tool install 'pre-commit'");
  });

  it('uv=false: add-ons go through pipx', async () => {
    const { runner, done } = run({ uv: false, addons: ['poetry'] });
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'python: apt packages',
      'python: poetry',
    ]);
    expect(runner.calls[1]?.script).toBe("pipx install 'poetry'");
  });

  it('pipx=false drops the apt package; with uv=false too the add-ons are skipped with a warning', async () => {
    const { runner, ic, done } = run({ uv: false, pipx: false });
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual(['python: apt packages']);
    expect(runner.calls[0]?.script).not.toContain("'pipx'");
    expect(ic.warnings).toEqual([
      'python: add-ons skipped (ruff): they need uv or pipx',
    ]);
  });

  it('an add-on failure becomes a warning and the install still resolves', async () => {
    const { runner, ic, done } = run(ALL, { fail: ['python: poetry'] });
    await expect(done).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.label).toBe('python: pre-commit');
    expect(ic.warnings).toEqual([
      expect.stringMatching(/^python: add-on poetry failed: /),
    ]);
  });

  it('needs apt', async () => {
    const { runner, done } = run({}, { apt: false });
    await expect(done).rejects.toThrow(
      'python: this component needs apt (Debian/Ubuntu)',
    );
    expect(runner.calls).toEqual([]);
  });

  it('a uv failure rejects', async () => {
    const { done } = run({}, { fail: ['python: uv'] });
    await expect(done).rejects.toThrow('python: uv');
  });

  it.skipIf(!hasBash)('every script parses with bash -n', async () => {
    for (const choices of [ALL, { uv: false }]) {
      const { runner, done } = run(choices);
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
    }
  });
});
