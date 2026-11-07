import { execFileSync } from 'node:child_process';
import { RecordingRunner, type Logger } from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { flutter } from './flutter';

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

function setup(
  opts: { fail?: string[]; present?: boolean; apt?: boolean } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const existing = new Set<string>();
  if (opts.apt !== false) existing.add('/usr/bin/apt-get');
  if (opts.present) existing.add('/opt/flutter/.git');
  const ic = createInstallContext({
    runner,
    ctx: { isRoot: true, user: 'alice', home: '/home/alice' },
    logger: silent,
    fetch: (() =>
      Promise.reject(new Error('no network in tests'))) as typeof fetch,
    exists: (p) => existing.has(p),
    listDir: () => [],
  });
  return { runner, ic };
}

const run = (ic: ReturnType<typeof setup>['ic'], overrides: Choices = {}) =>
  flutter.install(ic, mergeChoices(defaultsFor(flutter), overrides));

function expectValidBash(runner: RecordingRunner) {
  if (!hasBash) return;
  for (const call of runner.calls) {
    expect(
      () => execFileSync('bash', ['-n'], { input: call.script }),
      call.label,
    ).not.toThrow();
  }
}

describe('flutter', () => {
  it('defaults: prerequisites, stable clone owned by the user, profile, precache, fvm (bash parity + fvm)', async () => {
    const { runner, ic } = setup();
    await run(ic);
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'install Flutter build prerequisites'],
      ['root', 'create /opt/flutter'],
      ['user', 'clone Flutter (stable)'],
      ['root', 'configure Flutter ownership and PATH'],
      ['user', 'precache Flutter'],
      ['user', 'link Flutter to the Android SDK if present'],
      ['user', 'install fvm'],
    ]);
    const scripts = runner.calls.map((c) => c.script);
    expect(scripts[0]).toContain("'libgtk-3-dev'");
    expect(scripts[0]).toContain("'libstdc++-12-dev'");
    expect(scripts[1]).toBe("install -d -o 'alice' /opt/flutter");
    expect(scripts[2]).toBe(
      "git clone -b 'stable' https://github.com/flutter/flutter.git /opt/flutter",
    );
    expect(scripts[3]).toContain("chown -R 'alice' /opt/flutter");
    expect(scripts[3]).toContain('/etc/profile.d/devtools-flutter.sh');
    expect(scripts[3]).toContain(
      '*:/opt/flutter/bin:*) ;; *) export PATH="$PATH:/opt/flutter/bin"',
    );
    expect(scripts[4]).toContain('flutter precache');
    expect(scripts[5]).toContain(
      '[ -x /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager ]',
    );
    expect(scripts[5]).toContain(
      'flutter config --android-sdk /opt/android-sdk',
    );
    expect(scripts[6]).toContain('export PATH=/opt/flutter/bin:$PATH');
    expect(scripts[6]).toContain('dart pub global activate fvm');
    expect(scripts[6]).toContain('$HOME/.pub-cache/bin');
    expect(ic.warnings).toEqual([]);
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('all options on an existing checkout: switch channel and upgrade, web + fvm (android-sdk is its own component)', async () => {
    const { runner, ic } = setup({ present: true });
    await run(ic, { channel: 'beta', addons: ['android-sdk', 'web', 'fvm'] });
    expect(runner.calls.map((c) => c.label)).toEqual([
      'install Flutter build prerequisites',
      'upgrade Flutter (beta)',
      'configure Flutter ownership and PATH',
      'precache Flutter',
      'link Flutter to the Android SDK if present',
      'enable Flutter web support',
      'install fvm',
    ]);
    expect(runner.calls[1]?.script).toContain(
      "flutter channel 'beta'\nflutter upgrade",
    );
    expect(runner.calls[5]?.script).toContain('flutter config --enable-web');
    expect(runner.calls.some((c) => c.script.includes('sdkmanager "'))).toBe(
      false,
    );
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('fresh beta clone uses the beta branch', async () => {
    const { runner, ic } = setup();
    await run(ic, { channel: 'beta', addons: [] });
    expect(
      runner.calls.find((c) => c.label === 'clone Flutter (beta)')?.script,
    ).toContain("git clone -b 'beta'");
  });

  it('add-on failures become warnings; the install still resolves', async () => {
    const { runner, ic } = setup({
      fail: ['enable Flutter web support', 'install fvm'],
    });
    await expect(run(ic, { addons: ['web', 'fvm'] })).resolves.toBeUndefined();
    expect(runner.calls).toHaveLength(8);
    expect(ic.warnings).toEqual([
      'flutter add-on web failed: step failed: enable Flutter web support (exit code 1)',
      'flutter add-on fvm failed: step failed: install fvm (exit code 1)',
    ]);
  });

  it('fails when the clone fails', async () => {
    const { ic } = setup({ fail: ['clone Flutter (stable)'] });
    await expect(run(ic)).rejects.toThrow(
      'step failed: clone Flutter (stable)',
    );
  });

  it('needs apt', async () => {
    const { runner, ic } = setup({ apt: false });
    await expect(run(ic)).rejects.toThrow('flutter needs apt (Debian/Ubuntu)');
    expect(runner.calls).toEqual([]);
  });
});
