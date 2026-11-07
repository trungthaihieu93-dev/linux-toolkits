import { execFileSync } from 'node:child_process';
import { RecordingRunner, type Logger } from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { jenv } from './jenv';

const hasBash = (() => {
  try {
    execFileSync('bash', ['-c', 'true']);
    return true;
  } catch {
    return false;
  }
})();

const silent: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function setup(fail: string[] = []) {
  const runner = new RecordingRunner(new Set(fail));
  const ic = createInstallContext({
    runner,
    ctx: { isRoot: false, user: 'alice', home: '/home/alice' },
    logger: silent,
    fetch: (() =>
      Promise.reject(new Error('no network in tests'))) as typeof fetch,
    exists: () => false,
    listDir: () => [],
  });
  return { runner, ic };
}

const run = (ic: ReturnType<typeof setup>['ic'], overrides: Choices = {}) =>
  jenv.install(ic, mergeChoices(defaultsFor(jenv), overrides));

function expectValidBash(runner: RecordingRunner) {
  if (!hasBash) return;
  for (const call of runner.calls) {
    expect(
      () => execFileSync('bash', ['-n'], { input: call.script }),
      call.label,
    ).not.toThrow();
  }
}

describe('jenv', () => {
  it('defaults: clone, register every OpenJDK, export plugin, global 21, rc block (bash parity)', async () => {
    const { runner, ic } = setup();
    await run(ic);
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['user', 'install jenv and register JDKs'],
      ['user', 'enable jenv plugin export'],
      ['user', 'set jenv global 21'],
      ['user', 'add jenv to shell rc files'],
    ]);
    const [install, plugin, global, rc] = runner.calls.map((c) => c.script);
    expect(install).toContain('git -C "$HOME/.jenv" pull --ff-only');
    expect(install).toContain(
      'git clone https://github.com/jenv/jenv.git "$HOME/.jenv"',
    );
    expect(install).toContain('for d in /usr/lib/jvm/java-*-openjdk-*; do');
    expect(install).toContain('[ ! -L "$d" ]');
    expect(install).toContain('jenv add "$d"');
    expect(plugin).toContain('eval "$(jenv init -)"');
    expect(plugin).toContain("jenv enable-plugin 'export'");
    expect(global).toContain("jenv global '21'");
    expect(rc).toContain("'# >>> jenv >>>'");
    expect(rc).toContain('export PATH="$HOME/.jenv/bin:$PATH"');
    expect(rc).toContain('eval "$(jenv init -)"');
    expect(ic.warnings).toEqual([]);
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('all options: every plugin and global 25', async () => {
    const { runner, ic } = setup();
    await run(ic, { global: '25', addons: ['export', 'maven', 'gradle'] });
    expect(runner.calls.map((c) => c.label)).toEqual([
      'install jenv and register JDKs',
      'enable jenv plugin export',
      'enable jenv plugin maven',
      'enable jenv plugin gradle',
      'set jenv global 25',
      'add jenv to shell rc files',
    ]);
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('plugin and global failures become warnings; the rc block is still added', async () => {
    const { runner, ic } = setup([
      'enable jenv plugin maven',
      'set jenv global 17',
    ]);
    await expect(
      run(ic, { global: '17', addons: ['maven'] }),
    ).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.label).toBe('add jenv to shell rc files');
    expect(ic.warnings).toEqual([
      'jenv plugin maven failed: step failed: enable jenv plugin maven (exit code 1)',
      'setting the jenv global version to 17 (JDK 17 not registered?) failed: step failed: set jenv global 17 (exit code 1)',
    ]);
  });

  it('fails when jenv itself cannot be installed', async () => {
    const { runner, ic } = setup(['install jenv and register JDKs']);
    await expect(run(ic)).rejects.toThrow(
      'step failed: install jenv and register JDKs',
    );
    expect(runner.calls).toHaveLength(1);
  });
});
