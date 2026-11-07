import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { machine, tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingRunner, type Logger } from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { android, CMDLINE_TOOLS_FALLBACK, LICENSE_ERROR } from './android';

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
const STUDIO_HTML =
  '<a href="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip">old</a>' +
  '<a href="https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip">new</a>' +
  '<a href="https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip">mac</a>';
const LATEST_ZIP = 'commandlinetools-linux-13114758_latest.zip';

function setup(
  opts: {
    fail?: string[];
    yes?: boolean;
    apt?: boolean;
    fetch?: () => Promise<Response>;
  } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const urls: string[] = [];
  const ic = createInstallContext({
    runner,
    ctx: { isRoot: true, user: 'alice', home: '/home/alice' },
    logger: silent,
    yes: opts.yes ?? true,
    fetch: (async (input: string | URL | Request) => {
      urls.push(String(input));
      return opts.fetch ? opts.fetch() : new Response(STUDIO_HTML);
    }) as typeof fetch,
    exists: (p) => p === '/usr/bin/apt-get' && opts.apt !== false,
    listDir: () => [],
  });
  return { runner, ic, urls };
}

const run = (ic: ReturnType<typeof setup>['ic'], overrides: Choices = {}) =>
  android.install(ic, mergeChoices(defaultsFor(android), overrides));

function expectValidBash(runner: RecordingRunner) {
  if (!hasBash) return;
  for (const call of runner.calls) {
    expect(
      () => execFileSync('bash', ['-n'], { input: call.script }),
      call.label,
    ).not.toThrow();
  }
}

const BASE_LABELS = [
  ['root', 'install JDK for the Android SDK'],
  ['root', `install Android cmdline-tools (${LATEST_ZIP})`],
  ['user', 'install Android SDK packages'],
  ['root', 'write Android SDK profile'],
  ['user', 'link Flutter to the Android SDK if present'],
];

describe('android', () => {
  it('defaults: JDK, newest cmdline-tools, platform-tools + latest build-tools/platform, profile (bash parity)', async () => {
    const { runner, ic, urls } = setup();
    await run(ic);
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual(BASE_LABELS);
    const [jdk, tools, pkgs, profile, link] = runner.calls.map((c) => c.script);
    expect(jdk).toContain(
      "'openjdk-17-jdk-headless' 'unzip' 'curl' 'ca-certificates'",
    );
    expect(jdk).toContain("'default-jdk-headless'");
    expect(tools).toContain(
      `'https://dl.google.com/android/repository/${LATEST_ZIP}'`,
    );
    expect(tools).toContain(
      'mv "$tmp/cmdline-tools" /opt/android-sdk/cmdline-tools/latest',
    );
    expect(tools).toContain("chown -R 'alice' /opt/android-sdk");
    expect(pkgs).toContain('yes | "$sdkm" --licenses');
    expect(pkgs).toContain('tail -n1');
    expect(pkgs).toContain('yes | "$sdkm" "platform-tools" "$bt" "${pl[@]}"');
    expect(profile).toContain('export ANDROID_SDK_ROOT=/opt/android-sdk');
    expect(profile).toContain('/etc/profile.d/devtools-android.sh');
    expect(link).toContain('[ -x /opt/flutter/bin/flutter ]');
    expect(link).toContain('flutter config --android-sdk /opt/android-sdk');
    expect(urls).toEqual(['https://developer.android.com/studio']);
    expect(ic.warnings).toEqual([]);
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('all options: two platforms plus emulator, NDK and CMake as separate steps', async () => {
    const { runner, ic } = setup();
    await run(ic, {
      platforms: 'latest-and-previous',
      addons: ['emulator', 'ndk', 'cmake'],
    });
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ...BASE_LABELS,
      ['user', 'install Android emulator + system image'],
      ['user', 'install Android NDK'],
      ['user', 'install Android CMake'],
    ]);
    expect(runner.calls[2]?.script).toContain('tail -n2');
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('refuses to accept the licenses without consent and runs nothing', async () => {
    const { runner, ic, urls } = setup({ yes: false });
    await expect(run(ic)).rejects.toThrow(LICENSE_ERROR);
    expect(LICENSE_ERROR).toContain('-y');
    expect(runner.calls).toEqual([]);
    expect(urls).toEqual([]);
  });

  it.each([
    [
      'a network error',
      () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
      'ENOTFOUND',
    ],
    [
      'an HTTP error',
      () => Promise.resolve(new Response('', { status: 500 })),
      'HTTP 500',
    ],
    [
      'a page without links',
      () => Promise.resolve(new Response('<html></html>')),
      'no commandlinetools link',
    ],
  ])(
    'cmdline-tools: falls back to the pinned zip on %s',
    async (_name, respond, reason) => {
      const { runner, ic } = setup({ fetch: respond });
      await run(ic);
      expect(runner.calls[1]?.label).toBe(
        `install Android cmdline-tools (${CMDLINE_TOOLS_FALLBACK})`,
      );
      expect(ic.warnings).toHaveLength(1);
      expect(ic.warnings[0]).toContain(reason);
      expect(ic.warnings[0]).toContain(`using ${CMDLINE_TOOLS_FALLBACK}`);
    },
  );

  it('add-on failures become warnings; the install still resolves', async () => {
    const { runner, ic } = setup({
      fail: ['install Android emulator + system image', 'install Android NDK'],
    });
    await expect(
      run(ic, { addons: ['emulator', 'ndk', 'cmake'] }),
    ).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.label).toBe('install Android CMake');
    expect(ic.warnings).toEqual([
      'android add-on emulator failed: step failed: install Android emulator + system image (exit code 1)',
      'android add-on ndk failed: step failed: install Android NDK (exit code 1)',
    ]);
  });

  it('fails when the SDK packages cannot be installed', async () => {
    const { ic } = setup({ fail: ['install Android SDK packages'] });
    await expect(run(ic)).rejects.toThrow(
      'step failed: install Android SDK packages',
    );
  });

  it('needs apt', async () => {
    const { runner, ic } = setup({ apt: false });
    await expect(run(ic)).rejects.toThrow('android needs apt (Debian/Ubuntu)');
    expect(runner.calls).toEqual([]);
  });

  describe.skipIf(!hasBash)(
    'sdkmanager scripts against a fake sdkmanager',
    () => {
      const LIST = [
        'Installed packages:',
        '  Path | Version | Description | Location',
        'Available Packages:',
        '  build-tools;9.0.0             | 9.0.0        | Android SDK Build-Tools 9',
        '  build-tools;35.0.0            | 35.0.0       | Android SDK Build-Tools 35',
        '  build-tools;36.0.0-rc1        | 36.0.0 rc1   | Android SDK Build-Tools 36-rc1',
        '  cmake;3.22.1                  | 3.22.1       | CMake 3.22.1',
        '  cmake;3.31.6                  | 3.31.6       | CMake 3.31.6',
        '  ndk;26.3.11579264             | 26.3.11579264 | NDK (Side by side) 26.3.11579264',
        '  ndk;27.0.12077973             | 27.0.12077973 | NDK (Side by side) 27.0.12077973',
        '  platforms;android-9           | 2            | Android SDK Platform 9',
        '  platforms;android-35          | 2            | Android SDK Platform 35',
        '  platforms;android-36          | 2            | Android SDK Platform 36',
        '  platforms;android-36-ext18    | 1            | Android SDK Platform 36-ext18',
        '  system-images;android-35;google_apis;arm64-v8a | 1 | ARM 64 v8a',
        '  system-images;android-35;google_apis;x86_64    | 1 | Intel x86_64',
        '  system-images;android-36;google_apis;arm64-v8a | 1 | ARM 64 v8a',
        '  system-images;android-36;google_apis;x86_64    | 1 | Intel x86_64',
      ].join('\n');

      let root: string;
      beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'android-spec-'));
        const bin = join(root, 'cmdline-tools/latest/bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(root, 'list.txt'), `${LIST}\n`);
        writeFileSync(
          join(bin, 'sdkmanager'),
          `#!/bin/bash\ncase "$1" in --list) cat "$ANDROID_HOME/list.txt" ;; --licenses) ;; *) echo "$*" >> "$ANDROID_HOME/installed.txt" ;; esac\n`,
        );
        chmodSync(join(bin, 'sdkmanager'), 0o755);
      });
      afterAll(() => rmSync(root, { recursive: true, force: true }));

      async function installed(
        overrides: Choices,
        label: string,
      ): Promise<string> {
        rmSync(join(root, 'installed.txt'), { force: true });
        const { runner, ic } = setup();
        await run(ic, overrides);
        const script =
          runner.calls.find((c) => c.label === label)?.script ?? '';
        execFileSync(
          'bash',
          ['-c', `set -e\n${script.replaceAll('/opt/android-sdk', root)}`],
          { stdio: 'ignore' },
        );
        return readFileSync(join(root, 'installed.txt'), 'utf8').trim();
      }

      it('installs the newest stable build-tools and the newest platform', async () => {
        await expect(
          installed({}, 'install Android SDK packages'),
        ).resolves.toBe(
          'platform-tools build-tools;35.0.0 platforms;android-36',
        );
      });

      it('installs the two newest platforms for latest-and-previous', async () => {
        await expect(
          installed(
            { platforms: 'latest-and-previous' },
            'install Android SDK packages',
          ),
        ).resolves.toBe(
          'platform-tools build-tools;35.0.0 platforms;android-35 platforms;android-36',
        );
      });

      it('installs the newest NDK, CMake and a system image for this CPU', async () => {
        const abi = ['aarch64', 'arm64'].includes(machine())
          ? 'arm64-v8a'
          : 'x86_64';
        const all = { addons: ['emulator', 'ndk', 'cmake'] };
        await expect(
          installed(all, 'install Android emulator + system image'),
        ).resolves.toBe(`emulator system-images;android-36;google_apis;${abi}`);
        await expect(installed(all, 'install Android NDK')).resolves.toBe(
          'ndk;27.0.12077973',
        );
        await expect(installed(all, 'install Android CMake')).resolves.toBe(
          'cmake;3.31.6',
        );
      });
    },
  );
});
