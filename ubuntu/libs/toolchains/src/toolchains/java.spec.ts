import { execFileSync } from 'node:child_process';
import { RecordingRunner, type Logger } from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { GRADLE_FALLBACK_VERSION, gradleInstallScript, java } from './java';

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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function setup(
  opts: {
    fail?: string[];
    fetch?: () => Promise<Response>;
    apt?: boolean;
  } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return opts.fetch
      ? opts.fetch()
      : json({ version: '9.3.1', downloadUrl: 'ignored' });
  }) as typeof fetch;
  const ic = createInstallContext({
    runner,
    ctx: { isRoot: true, user: 'alice', home: '/home/alice' },
    logger: silent,
    fetch: fetchFn,
    exists: (p) => (p === '/usr/bin/apt-get' ? opts.apt !== false : false),
    listDir: () => [],
  });
  return { runner, ic, urls };
}

const run = (ic: ReturnType<typeof setup>['ic'], overrides: Choices = {}) =>
  java.install(ic, mergeChoices(defaultsFor(java), overrides));

function expectValidBash(runner: RecordingRunner) {
  if (!hasBash) return;
  for (const call of runner.calls) {
    expect(
      () => execFileSync('bash', ['-n'], { input: call.script }),
      call.label,
    ).not.toThrow();
  }
}

describe('java', () => {
  it('defaults: JDK 21 as system default, Maven and the latest Gradle', async () => {
    const { runner, ic, urls } = setup();
    await run(ic);
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'install OpenJDK 21'],
      ['root', 'set default JDK 21'],
      ['root', 'install Maven'],
      ['root', 'install Gradle 9.3.1'],
    ]);
    const [jdk, def, maven, gradle] = runner.calls.map((c) => c.script);
    expect(jdk).toContain("'openjdk-21-jdk'");
    expect(jdk).not.toContain('openjdk-25-jdk');
    expect(jdk).toContain(
      "JDK $v not installed (not available from this release's apt repos?)",
    );
    expect(jdk).toContain('no JDK could be installed');
    expect(def).toContain("compgen -G '/usr/lib/jvm/java-21-openjdk-*'");
    expect(def).toContain('update-alternatives --set java "$d/bin/java"');
    expect(def).toContain('update-alternatives --set javac "$d/bin/javac"');
    expect(maven).toContain("'maven'");
    expect(maven).toContain('mvn -version');
    expect(gradle).toContain(
      "'https://services.gradle.org/distributions/gradle-9.3.1-bin.zip'",
    );
    expect(gradle).toContain(
      "'https://services.gradle.org/distributions/gradle-9.3.1-bin.zip.sha256'",
    );
    expect(gradle).toContain('sha256sum -c --quiet -');
    expect(gradle).toContain(
      "ln -sfn '/opt/gradle/gradle-9.3.1' '/opt/gradle/current'",
    );
    expect(gradle).toContain('/etc/profile.d/devtools-gradle.sh');
    expect(gradle).toContain('*:/opt/gradle/current/bin:*');
    expect(urls).toEqual(['https://services.gradle.org/versions/current']);
    expect(ic.warnings).toEqual([]);
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('all options: every JDK, chosen default, every add-on (jenv is left to its component)', async () => {
    const { runner, ic } = setup();
    await run(ic, {
      jdk: ['25', '17', '21'],
      default: '25',
      addons: ['maven', 'gradle', 'jenv'],
    });
    expect(runner.calls.map((c) => c.label)).toEqual([
      'install OpenJDK 17, 21, 25',
      'set default JDK 25',
      'install Maven',
      'install Gradle 9.3.1',
    ]);
    expect(runner.calls[0]?.script).toContain(
      "'openjdk-17-jdk' 'openjdk-21-jdk' 'openjdk-25-jdk'",
    );
    expect(runner.calls.some((c) => c.script.includes('jenv'))).toBe(false);
    expectValidBash(runner);
    expect(runner.calls).toMatchSnapshot();
  });

  it('no add-ons: only the JDK steps', async () => {
    const { runner, ic, urls } = setup();
    await run(ic, { addons: [] });
    expect(runner.calls.map((c) => c.label)).toEqual([
      'install OpenJDK 21',
      'set default JDK 21',
    ]);
    expect(urls).toEqual([]);
  });

  it.each([
    [['17'], '17'],
    [['17', '25'], '25'],
  ])(
    'default JDK not selected (%j): warns and uses the highest selected',
    async (jdk, used) => {
      const { runner, ic } = setup();
      await run(ic, { jdk, default: '21', addons: [] });
      expect(ic.warnings).toEqual([
        `default JDK 21 is not among the selected JDKs (${jdk.join(', ')}); using ${used}`,
      ]);
      expect(runner.calls[1]?.label).toBe(`set default JDK ${used}`);
    },
  );

  it.each([
    [
      'a network error',
      () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
      'ENOTFOUND',
    ],
    ['an HTTP error', () => Promise.resolve(json({}, 503)), 'HTTP 503'],
    [
      'an unusable version',
      () => Promise.resolve(json({ version: '9; rm -rf /' })),
      'no usable version',
    ],
  ])(
    'gradle: falls back to the pinned version on %s',
    async (_name, respond, reason) => {
      const { runner, ic } = setup({ fetch: respond });
      await run(ic);
      expect(runner.calls.at(-1)?.label).toBe(
        `install Gradle ${GRADLE_FALLBACK_VERSION}`,
      );
      expect(ic.warnings).toHaveLength(1);
      expect(ic.warnings[0]).toContain(
        'could not resolve the latest Gradle release (',
      );
      expect(ic.warnings[0]).toContain(reason);
      expect(ic.warnings[0]).toContain(`using ${GRADLE_FALLBACK_VERSION}`);
    },
  );

  it('add-on and default-JDK failures become warnings; the install still resolves', async () => {
    const { runner, ic } = setup({
      fail: ['set default JDK 21', 'install Maven', 'install Gradle 9.3.1'],
    });
    await expect(run(ic)).resolves.toBeUndefined();
    expect(runner.calls).toHaveLength(4);
    expect(ic.warnings).toEqual([
      'setting the default JDK to 21 failed: step failed: set default JDK 21 (exit code 1)',
      'java add-on maven failed: step failed: install Maven (exit code 1)',
      'java add-on gradle failed: step failed: install Gradle 9.3.1 (exit code 1)',
    ]);
  });

  it('fails when no JDK could be installed', async () => {
    const { runner, ic } = setup({ fail: ['install OpenJDK 21'] });
    await expect(run(ic)).rejects.toThrow('step failed: install OpenJDK 21');
    expect(runner.calls).toHaveLength(1);
  });

  it('needs apt', async () => {
    const { runner, ic } = setup({ apt: false });
    await expect(run(ic)).rejects.toThrow('java needs apt (Debian/Ubuntu)');
    expect(runner.calls).toEqual([]);
  });

  it('rejects an unsafe Gradle version', () => {
    expect(() => gradleInstallScript('9.2.0$(id)')).toThrow(
      'invalid Gradle version',
    );
  });

  it.skipIf(!hasBash)(
    'JDK check warns per missing JDK and fails when none is present',
    async () => {
      const { runner, ic } = setup();
      await run(ic, { jdk: ['17'], default: '17', addons: [] });
      const script = runner.calls[0]?.script ?? '';
      // Run only the post-install check, pointed at a path that cannot exist.
      const check = script
        .slice(script.indexOf('found=0'))
        .replace('/usr/lib/jvm/java-$v-openjdk-*', '/nonexistent-$v-*');
      let stderr = '';
      expect(() => {
        try {
          execFileSync('bash', ['-c', check], {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
        } catch (error) {
          stderr = String((error as { stderr?: Buffer }).stderr);
          throw error;
        }
      }).toThrow();
      expect(stderr).toContain('JDK 17 not installed');
      expect(stderr).toContain('no JDK could be installed');
    },
  );
});
