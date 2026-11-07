import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  userScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { nvmBun } from './nvm-bun';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const noFetch = (() =>
  Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch;

function run(overrides: Choices = {}, failLabels: string[] = []) {
  const runner = new RecordingRunner(new Set(failLabels));
  const ic = createInstallContext({
    runner,
    ctx,
    logger,
    fetch: noFetch,
    exists: () => false,
    listDir: () => [],
  });
  return {
    runner,
    ic,
    done: nvmBun.install(ic, mergeChoices(defaultsFor(nvmBun), overrides)),
  };
}

const ALL: Choices = {
  node: 'lts-prev',
  bun: true,
  addons: ['pnpm', 'yarn', 'typescript'],
};

describe('nvm-bun install', () => {
  it('defaults: bun, nvm + latest LTS as default, nvm/bun rc blocks, pnpm and typescript (bash parity)', async () => {
    const { runner, ic, done } = run();
    await done;
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['user', 'nvm-bun: bun'],
      ['user', 'nvm-bun: nvm + node'],
      ['user', 'nvm-bun: shell init'],
      ['user', 'nvm-bun: pnpm'],
      ['user', 'nvm-bun: typescript'],
    ]);
    const [bun, nvm, rc, pnpm, ts] = runner.calls.map((c) => c.script);
    expect(bun).toBe('curl -fsSL https://bun.sh/install | bash');
    expect(nvm).toContain(
      'https://api.github.com/repos/nvm-sh/nvm/releases/latest',
    );
    expect(nvm).toContain('[ -n "$tag" ] || tag=v0.40.3');
    expect(nvm).toContain("nvm install --lts\nnvm alias default 'lts/*'");
    expect(nvm).toContain('node --version; bun --version');
    expect(rc).toContain("'# >>> nvm >>>'");
    expect(rc).toContain("grep -qE 'NVM_DIR'");
    expect(rc).toContain("'# >>> bun >>>'");
    expect(rc).toContain("grep -qE 'BUN_INSTALL|\\.bun/bin'");
    expect(rc).toContain(
      '[ -s "$NVM_DIR/bash_completion" ] && \\. "$NVM_DIR/bash_completion"',
    );
    expect(pnpm).toContain(
      'command -v corepack >/dev/null 2>&1 || npm install -g corepack',
    );
    expect(pnpm).toContain('corepack enable pnpm');
    expect(ts).toContain('npm install -g typescript tsx');
    expect(ic.warnings).toEqual([]);
  });

  it('all options: previous LTS, bun, every add-on', async () => {
    const { runner, done } = run(ALL);
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'nvm-bun: bun',
      'nvm-bun: nvm + node',
      'nvm-bun: shell init',
      'nvm-bun: pnpm',
      'nvm-bun: yarn',
      'nvm-bun: typescript',
    ]);
    const nvm = runner.calls[1]?.script ?? '';
    expect(nvm).toContain('nvm ls-remote --lts --no-colors');
    expect(nvm).toContain('nvm install "$prev"');
    expect(nvm).toContain('nvm alias default "$prev"');
    expect(runner.calls[4]?.script).toContain('corepack enable yarn');
  });

  it('current: nvm install node', async () => {
    const { runner, done } = run({ node: 'current' });
    await done;
    expect(runner.calls[1]?.script).toContain(
      'nvm install node\nnvm alias default node',
    );
  });

  it('bun=false skips bun, its rc block and its version check', async () => {
    const { runner, done } = run({ bun: false, addons: [] });
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'nvm-bun: nvm + node',
      'nvm-bun: shell init',
    ]);
    expect(runner.calls[0]?.script).not.toContain('bun --version');
    expect(runner.calls[1]?.script).not.toContain('bun >>>');
  });

  it('an add-on failure becomes a warning and the install still resolves', async () => {
    const { runner, ic, done } = run(ALL, ['nvm-bun: yarn']);
    await expect(done).resolves.toBeUndefined();
    expect(runner.calls.map((c) => c.label)).toContain('nvm-bun: typescript');
    expect(ic.warnings).toEqual([
      expect.stringMatching(
        /^nvm-bun: add-on yarn failed: step failed: nvm-bun: yarn/,
      ),
    ]);
  });

  it('a main step failure rejects', async () => {
    const { done } = run({}, ['nvm-bun: nvm + node']);
    await expect(done).rejects.toThrow('nvm-bun: nvm + node');
  });

  it.skipIf(!hasBash)('every script parses with bash -n', async () => {
    for (const choices of [{}, ALL, { node: 'current', bun: false }]) {
      const { runner, done } = run(choices);
      await done;
      for (const call of runner.calls) {
        const res = spawnSync('bash', ['-n'], {
          input: userScript(call.script),
        });
        expect(res.status, `${call.label}: ${res.stderr}`).toBe(0);
      }
    }
  });

  it.skipIf(!hasBash)(
    'previous LTS resolves to the newest LTS major below the current one',
    async () => {
      const { runner, done } = run({ node: 'lts-prev', addons: [] });
      await done;
      const nvmLines = (runner.calls[1]?.script ?? '').split('\n');
      const start = nvmLines.findIndex((l) => l.startsWith('majors='));
      const resolve = nvmLines.slice(start, start + 5).join('\n');
      const stub = (out: string) =>
        `set -e\nnvm() { printf '%s\\n' ${out}; }\n${resolve}`;
      const ok = spawnSync(
        'bash',
        [
          '-c',
          stub(
            `'       v20.19.5   (LTS: Iron)' '       v22.21.1   (LTS: Jod)' '->     v24.11.1   (Latest LTS: Krypton)' '        v4.2.0   (LTS: Argon)'`,
          ),
        ],
        { encoding: 'utf8' },
      );
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout.trim()).toBe('previous Node LTS: v22');
      const bad = spawnSync('bash', ['-c', stub(`'            N/A'`)], {
        encoding: 'utf8',
      });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain('could not determine the previous Node LTS');
    },
  );
});
