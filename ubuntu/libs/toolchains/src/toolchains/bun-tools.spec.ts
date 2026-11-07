import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  userScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { BUN_TOOL_PACKAGES, bunTools } from './bun-tools';

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
    done: bunTools.install(ic, mergeChoices(defaultsFor(bunTools), overrides)),
  };
}

describe('bun-tools install', () => {
  it('defaults (= every package): one bun step installing all of them, then trust (bash parity)', async () => {
    const { runner, ic, done } = run();
    await done;
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['user', 'bun-tools: bun add -g'],
    ]);
    const script = runner.calls[0]?.script ?? '';
    expect(script).toContain(
      `for p in ${BUN_TOOL_PACKAGES.map((p) => `'${p}'`).join(' ')}; do`,
    );
    expect(script).toContain(
      'bun add -g "$p@latest" </dev/null || failed="$failed $p"',
    );
    expect(script).toContain('bun pm -g trust --all');
    expect(script).toContain('echo "FAILED packages:$failed" >&2; exit 1');
    expect(script).toContain('select nvm-bun first');
    expect(ic.warnings).toEqual([]);
  });

  it('installs only the selected packages', async () => {
    const { runner, done } = run({ packages: ['nx', '@openai/codex'] });
    await done;
    expect(runner.calls[0]?.script).toContain(
      "for p in 'nx' '@openai/codex'; do",
    );
    expect(runner.calls[0]?.script).not.toContain('turbo');
  });

  it('runs nothing when no package is selected', async () => {
    const { runner, done } = run({ packages: [] });
    await done;
    expect(runner.calls).toEqual([]);
  });

  it('a failed package fails the component', async () => {
    const { done } = run({}, ['bun-tools: bun add -g']);
    await expect(done).rejects.toThrow('bun-tools: bun add -g');
  });

  it.skipIf(!hasBash)('the script parses with bash -n', async () => {
    const { runner, done } = run();
    await done;
    for (const call of runner.calls) {
      const res = spawnSync('bash', ['-n'], { input: userScript(call.script) });
      expect(res.status, `${call.label}: ${res.stderr}`).toBe(0);
    }
  });
});
