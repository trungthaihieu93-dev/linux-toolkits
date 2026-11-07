import chalk from 'chalk';
import { DryRunRunner, RecordingRunner } from '@linux-toolchain/core';
import type { Toolchain } from '@linux-toolchain/toolchains';
import { spyCatalog, testCtx, testDeps } from '../testing/helpers';
import { RELOGIN_NOTE } from './execute';
import { BUN_TOOLS_NEEDS_BUN, NO_TTY_MESSAGE, runInstall } from './install';
import { parseRunConfig, type InstallFlags } from './options';
import { ANDROID_LICENSE_QUESTION } from './prompts';

const ADDONS = 'Add-ons (recommended are pre-checked)';
const SELECT = 'Select toolchains to install';

beforeAll(() => {
  chalk.level = 0;
});

function config(ids: string[], flags: InstallFlags = {}) {
  return parseRunConfig(ids, flags);
}

describe('runInstall: interactive flow', () => {
  it('walks each selected toolchain and installs the chosen options', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    deps.prompts
      .answer(SELECT, ['docker', 'java', 'go'])
      .answer('JDK versions', ['17', '21'])
      .answer('Default JDK', '17')
      // go, java, docker ask their add-ons in catalog order
      .answer(ADDONS, ['gopls', 'delve'], ['maven', 'gradle'], ['hadolint'])
      .answer('Add the user to the docker group', true);

    expect(await runInstall(config([]), deps)).toBe(0);

    expect(Object.fromEntries(installed)).toEqual({
      go: {
        choices: { version: 'latest', addons: ['gopls', 'delve'] },
        yes: false,
      },
      java: {
        choices: {
          jdk: ['17', '21'],
          default: '17',
          addons: ['maven', 'gradle'],
        },
        yes: false,
      },
      docker: { choices: { group: true, addons: ['hadolint'] }, yes: false },
    });
    expect(deps.out.text).toContain('Go (1/3)');
    expect(deps.out.text).toContain('JDK (OpenJDK) (2/3)');
    expect(deps.out.text).toContain('Docker Engine (3/3)');
    expect(deps.out.text).toMatch(
      /java\s+jdk=17,21\s+default=17\s+addons=maven,gradle/,
    );
    expect(deps.prompts.calls.at(-1)?.message).toBe('Proceed?');
    expect(deps.out.text).toContain('ok:       go java docker');
  });

  it('prompts toolchains added by an add-on, after the user picked it', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    deps.prompts
      .answer(ADDONS, ['maven', 'jenv'])
      .answer('Global Java version', '21');

    expect(await runInstall(config(['java']), deps)).toBe(0);

    expect(deps.out.text).toContain(
      '==> adding jenv (selected by the java add-on jenv)',
    );
    expect(deps.out.text).toContain('jenv (2/2)');
    expect(deps.prompts.calls.map((c) => c.message)).toContain(
      'Global Java version',
    );
    expect([...installed.keys()]).toEqual(['java', 'jenv']);
  });

  it('does not ask sub-options with --defaults but still confirms', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    expect(await runInstall(config(['go'], { defaults: true }), deps)).toBe(0);
    expect(deps.prompts.calls.map((c) => c.message)).toEqual(['Proceed?']);
    expect(installed.get('go')?.choices).toEqual({
      version: 'latest',
      addons: ['gopls', 'golangci-lint'],
    });
  });

  it('installs nothing when the review is declined', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    deps.prompts.answer('Proceed?', false);
    expect(await runInstall(config(['go'], { defaults: true }), deps)).toBe(0);
    expect(installed.size).toBe(0);
    expect(deps.runner.calls).toEqual([]);
    expect(deps.out.text).toContain('nothing installed');
  });

  it('logs "nothing selected" when the menu is left empty', async () => {
    const deps = testDeps({ tty: true });
    deps.prompts.answer(SELECT, []);
    expect(await runInstall(config([]), deps)).toBe(0);
    expect(deps.out.text).toContain('==> nothing selected');
  });
});

describe('runInstall: non-interactive', () => {
  it('needs ids without a TTY', async () => {
    const deps = testDeps();
    expect(await runInstall(config([]), deps)).toBe(2);
    expect(deps.err.text).toContain(NO_TTY_MESSAGE);
  });

  it('applies --opt overrides and defaults without prompting', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog });
    const code = await runInstall(
      parseRunConfig(['java'], {
        opt: ['java.jdk=17,25', 'java.addons=gradle'],
      }),
      deps,
    );
    expect(code).toBe(0);
    expect(deps.prompts.calls).toEqual([]);
    expect(installed.get('java')?.choices).toEqual({
      jdk: ['17', '25'],
      default: '25',
      addons: ['gradle'],
    });
  });

  it('adds required and add-on implied toolchains with their defaults', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog });
    const code = await runInstall(
      parseRunConfig(['bun-tools', 'flutter'], {
        opt: ['flutter.addons=android-sdk'],
        yes: true,
      }),
      deps,
    );
    expect(code).toBe(0);
    expect(deps.out.text).toContain(
      '==> adding nvm-bun (required by bun-tools, not found for dev)',
    );
    expect(deps.out.text).toContain(
      '==> adding android (selected by the flutter add-on android-sdk)',
    );
    expect([...installed.keys()]).toEqual([
      'nvm-bun',
      'bun-tools',
      'flutter',
      'android',
    ]);
    expect(installed.get('android')).toEqual({
      choices: { platforms: 'latest', 'build-tools': 'latest', addons: [] },
      yes: true,
    });
  });
});

describe('runInstall: Android SDK licenses', () => {
  it('passes yes=true to android once the licenses are accepted', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    deps.prompts.answer(ANDROID_LICENSE_QUESTION, true);
    expect(
      await runInstall(config(['android', 'go'], { defaults: true }), deps),
    ).toBe(0);
    expect(installed.get('android')?.yes).toBe(true);
    expect(installed.get('go')?.yes).toBe(false);
  });

  it('fails android and continues when the licenses are declined', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    deps.prompts.answer(ANDROID_LICENSE_QUESTION, false);
    expect(
      await runInstall(config(['android', 'cpp'], { defaults: true }), deps),
    ).toBe(1);
    expect([...installed.keys()]).toEqual(['cpp']);
    expect(deps.err.text).toContain(
      'component failed: android: licenses not accepted',
    );
    expect(deps.out.text).toContain('failed:   android');
  });

  it('does not ask with -y', async () => {
    const { catalog, installed } = spyCatalog();
    const deps = testDeps({ catalog, tty: true });
    expect(await runInstall(config(['android'], { yes: true }), deps)).toBe(0);
    expect(deps.prompts.calls).toEqual([]);
    expect(installed.get('android')?.yes).toBe(true);
  });

  it('fails with the library error when there is no TTY and no -y', async () => {
    const deps = testDeps();
    expect(await runInstall(config(['android']), deps)).toBe(1);
    // The library's LICENSE_ERROR (not exported from the package entry point).
    expect(deps.err.text).toContain(
      'component failed: android: Android SDK licenses must be accepted (https://developer.android.com/studio/terms): re-run with -y to accept them',
    );
  });
});

function fakeToolchain(id: string, warn = false): Toolchain {
  return {
    id,
    label: id.toUpperCase(),
    description: `${id} for tests`,
    options: [],
    async install(ic) {
      if (warn) ic.warn(`${id} add-on failed`);
      await ic.runner.asRoot(`echo ${id}`, `${id} step`);
    },
  };
}

describe('runInstall: execution', () => {
  const fakes = [
    fakeToolchain('alpha'),
    fakeToolchain('beta'),
    fakeToolchain('gamma', true),
  ];

  it('isolates a failing toolchain, reports it and exits 1', async () => {
    const runner = new RecordingRunner(new Set(['beta step']));
    const close = vi.fn();
    const deps = testDeps({
      catalog: fakes,
      createRunner: () => Object.assign(runner, { close }),
    });
    const code = await runInstall(
      parseRunConfig(['alpha', 'beta', 'gamma'], { yes: true }, fakes),
      deps,
    );

    expect(code).toBe(1);
    expect(runner.calls.map((c) => c.label)).toEqual([
      'apt-get update',
      'install base packages',
      'alpha step',
      'beta step',
      'gamma step',
    ]);
    expect(deps.err.text).toContain(
      'component failed: beta: step failed: beta step (exit code 1)',
    );
    expect(deps.out.text).toContain('ok:       alpha gamma');
    expect(deps.out.text).toContain('failed:   beta');
    expect(deps.out.text).toContain(
      'warnings:\n    - gamma: gamma add-on failed',
    );
    expect(deps.out.text.trimEnd().endsWith(RELOGIN_NOTE)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('exits 0 when everything succeeds', async () => {
    const deps = testDeps({ catalog: fakes });
    expect(
      await runInstall(
        parseRunConfig([], { all: true, yes: true }, fakes),
        deps,
      ),
    ).toBe(0);
    expect(deps.out.text).toContain('ok:       alpha beta gamma');
    expect(deps.out.text).not.toContain('failed:');
  });

  it('stops before any toolchain when apt-get update fails', async () => {
    const runner = new RecordingRunner(new Set(['apt-get update']));
    const deps = testDeps({ catalog: fakes, createRunner: () => runner });
    expect(
      await runInstall(parseRunConfig(['alpha'], { yes: true }, fakes), deps),
    ).toBe(1);
    expect(runner.calls.map((c) => c.label)).toEqual(['apt-get update']);
    expect(deps.err.text).toContain('apt-get update failed');
  });

  it('warns without apt and needs curl', async () => {
    const deps = testDeps({ catalog: fakes, hasApt: () => false });
    expect(
      await runInstall(parseRunConfig(['alpha'], { yes: true }, fakes), deps),
    ).toBe(0);
    expect(deps.err.text).toContain(
      'apt not found: components that need it will fail',
    );
    expect(deps.runner.calls.map((c) => c.label)).toEqual(['alpha step']);

    const noCurl = testDeps({
      catalog: fakes,
      hasApt: () => false,
      hasCurl: () => false,
    });
    expect(
      await runInstall(parseRunConfig(['alpha'], { yes: true }, fakes), noCurl),
    ).toBe(1);
    expect(noCurl.err.text).toContain('curl is required');
  });

  it('refuses non-Linux platforms', async () => {
    const deps = testDeps({ platform: 'darwin' });
    expect(await runInstall(config(['go']), deps)).toBe(1);
    expect(deps.err.text).toContain('only runs on Linux');
    expect(deps.runner.calls).toEqual([]);
  });

  it('reports context errors such as --user without root as usage errors', async () => {
    const deps = testDeps({
      resolveContext: () => {
        throw new Error('--user needs root (run with sudo, or drop --user)');
      },
    });
    expect(await runInstall(config(['go'], { user: 'bob' }), deps)).toBe(2);
    expect(deps.err.text).toContain('--user needs root');
    expect(deps.runner.calls).toEqual([]);
  });

  it('resolves the context leniently for a dry run', async () => {
    const seen: [string | undefined, boolean][] = [];
    const deps = testDeps({
      resolveContext: (user, dryRun) => {
        seen.push([user, dryRun]);
        return testCtx;
      },
    });
    await runInstall(
      config(['go'], { user: 'bob', dryRun: true, yes: true }),
      deps,
    );
    await runInstall(config(['go'], { yes: true }), deps);
    expect(seen).toEqual([
      ['bob', true],
      [undefined, false],
    ]);
  });
});

describe('runInstall: selection usage errors', () => {
  it('rejects --opt for a toolchain that is not selected', async () => {
    const { catalog: spy, installed } = spyCatalog();
    const deps = testDeps({ catalog: spy });
    const code = await runInstall(
      parseRunConfig(
        ['go'],
        { opt: ['java.jdk=17', 'rust.addons='], yes: true },
        spy,
      ),
      deps,
    );
    expect(code).toBe(2);
    expect(deps.err.text).toContain(
      '--opt for a toolchain that is not selected: java, rust; select it or drop the --opt',
    );
    expect(installed.size).toBe(0);
    expect(deps.runner.calls).toEqual([]);
  });

  it('accepts --opt for a toolchain the selection rules add', async () => {
    const { catalog: spy, installed } = spyCatalog();
    // bun is missing (listDir/exists probes are empty), so bun-tools adds nvm-bun.
    const deps = testDeps({ catalog: spy });
    const code = await runInstall(
      parseRunConfig(
        ['bun-tools'],
        { opt: ['nvm-bun.addons=yarn'], yes: true },
        spy,
      ),
      deps,
    );
    expect(code, deps.err.text).toBe(0);
    expect(installed.get('nvm-bun')?.choices['addons']).toEqual(['yarn']);
  });

  it('rejects bun-tools with nvm-bun.bun=false', async () => {
    for (const ids of [['bun-tools'], ['nvm-bun', 'bun-tools']]) {
      const { catalog: spy, installed } = spyCatalog();
      const deps = testDeps({ catalog: spy });
      const code = await runInstall(
        parseRunConfig(ids, { opt: ['nvm-bun.bun=false'], yes: true }, spy),
        deps,
      );
      expect(code, ids.join(',')).toBe(2);
      expect(deps.err.text).toContain(BUN_TOOLS_NEEDS_BUN);
      expect(installed.size).toBe(0);
    }
  });

  it('allows nvm-bun.bun=false without bun-tools, and bun-tools when bun exists', async () => {
    const { catalog: spy, installed } = spyCatalog();
    const deps = testDeps({ catalog: spy });
    expect(
      await runInstall(
        parseRunConfig(
          ['nvm-bun'],
          { opt: ['nvm-bun.bun=false'], yes: true },
          spy,
        ),
        deps,
      ),
    ).toBe(0);
    expect(installed.get('nvm-bun')?.choices['bun']).toBe(false);

    const withBun = spyCatalog();
    const present = testDeps({
      catalog: withBun.catalog,
      exists: (path) => path === `${testCtx.home}/.bun/bin/bun`,
    });
    expect(
      await runInstall(
        parseRunConfig(['bun-tools'], { yes: true }, withBun.catalog),
        present,
      ),
    ).toBe(0);
    expect([...withBun.installed.keys()]).toEqual(['bun-tools']);
  });
});

describe('runInstall: dry run', () => {
  it('prints the [root] and [user] scripts of the real installers', async () => {
    const deps = testDeps();
    const runner = new DryRunRunner(deps.out);
    deps.createRunner = () => runner;
    const code = await runInstall(
      parseRunConfig(['nvm-bun', 'go'], {
        defaults: true,
        yes: true,
        dryRun: true,
      }),
      deps,
    );
    expect(code).toBe(0);
    expect(deps.out.text).toContain('Dry run: printing the scripts');
    expect(deps.out.text).toContain('[root] apt-get update\napt-get update -y');
    expect(deps.out.text).toMatch(/^\[user\] /m);
    expect(deps.out.text).toContain(`Installing for user: ${testCtx.user}`);
  });
});
