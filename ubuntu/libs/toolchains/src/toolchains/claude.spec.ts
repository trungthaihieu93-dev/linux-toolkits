import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  userScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { claude } from './claude';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

async function run(fail: string[] = []) {
  const runner = new RecordingRunner(new Set(fail));
  const ic = createInstallContext({
    runner,
    ctx: { isRoot: true, user: 'alice', home: '/home/alice' },
    logger,
    exists: () => false,
    listDir: () => [],
    fetch: (() =>
      Promise.reject(new Error('no network in tests'))) as typeof fetch,
  });
  await claude.install(ic, {});
  return runner.calls;
}

describe('claude', () => {
  it('has no options', () => {
    expect(claude.options).toEqual([]);
  });

  it('runs the native installer as the user, like install-toolchains.sh (parity)', async () => {
    const calls = await run();
    expect(calls).toEqual([
      {
        as: 'user',
        label: 'claude: native installer',
        script:
          'curl -fsSL https://claude.ai/install.sh | bash; claude --version',
      },
    ]);
    expect(calls).toMatchSnapshot();
  });

  it('propagates an installer failure', async () => {
    await expect(run(['claude: native installer'])).rejects.toThrow(
      /claude: native installer/,
    );
  });

  it.skipIf(!hasBash)('produces a script that passes bash -n', async () => {
    for (const c of await run()) {
      expect(spawnSync('bash', ['-n', '-c', userScript(c.script)]).status).toBe(
        0,
      );
    }
  });
});
