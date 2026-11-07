import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  rootScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { docker, dockerDeps, dockerRepoTarget } from './docker';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const UBUNTU = {
  ID: 'ubuntu',
  VERSION_CODENAME: 'noble',
  UBUNTU_CODENAME: 'noble',
};

const TAGS: Record<string, string> = {
  'jesseduffield/lazydocker': 'v0.25.2',
  'wagoodman/dive': 'v0.13.1',
  'hadolint/hadolint': 'v2.15.1',
};

/** Fake GitHub API: latest tag per repo; `offline` makes every request fail. */
function fakeFetch(offline = false) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (offline) throw new Error('network down');
    const repo = url
      .replace('https://api.github.com/repos/', '')
      .replace('/releases/latest', '');
    const tag = TAGS[repo];
    return tag
      ? new Response(JSON.stringify({ tag_name: tag }), { status: 200 })
      : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fn, urls };
}

interface RunOpts {
  os?: Record<string, string>;
  cpu?: 'amd64' | 'arm64';
  apt?: boolean;
  systemd?: boolean;
  offline?: boolean;
  fail?: string[];
}

async function run(overrides: Choices = {}, opts: RunOpts = {}) {
  vi.spyOn(dockerDeps, 'osRelease').mockReturnValue(opts.os ?? UBUNTU);
  vi.spyOn(dockerDeps, 'arch').mockReturnValue(opts.cpu ?? 'amd64');
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const net = fakeFetch(opts.offline);
  const ic = createInstallContext({
    runner,
    ctx: { isRoot: true, user: 'alice', home: '/home/alice' },
    logger,
    fetch: net.fn,
    exists: (p) =>
      (p === '/usr/bin/apt-get' && opts.apt !== false) ||
      (p === '/run/systemd/system' && opts.systemd !== false),
    listDir: () => [],
  });
  await docker.install(ic, mergeChoices(defaultsFor(docker), overrides));
  return { calls: runner.calls, warnings: ic.warnings, urls: net.urls };
}

const allAddons: Choices = { addons: ['lazydocker', 'dive', 'hadolint'] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dockerRepoTarget', () => {
  it.each([
    ['ubuntu', UBUNTU, { distro: 'ubuntu', codename: 'noble' }],
    [
      'debian',
      { ID: 'debian', VERSION_CODENAME: 'bookworm' },
      { distro: 'debian', codename: 'bookworm' },
    ],
    [
      'linuxmint (ID_LIKE ubuntu)',
      {
        ID: 'linuxmint',
        ID_LIKE: 'ubuntu debian',
        VERSION_CODENAME: 'wilma',
        UBUNTU_CODENAME: 'noble',
      },
      { distro: 'ubuntu', codename: 'noble' },
    ],
    [
      'ID_LIKE debian with DEBIAN_CODENAME',
      {
        ID: 'lmde',
        ID_LIKE: 'debian',
        VERSION_CODENAME: 'faye',
        DEBIAN_CODENAME: 'bookworm',
      },
      { distro: 'debian', codename: 'bookworm' },
    ],
    [
      'ID_LIKE debian without DEBIAN_CODENAME',
      { ID: 'raspbian', ID_LIKE: 'debian', VERSION_CODENAME: 'bookworm' },
      { distro: 'debian', codename: 'bookworm' },
    ],
  ])('%s', (_name, os, expected) => {
    expect(dockerRepoTarget(os)).toEqual(expected);
  });

  it('rejects unsupported distros', () => {
    expect(() =>
      dockerRepoTarget({ ID: 'fedora', ID_LIKE: 'rhel', VERSION_CODENAME: '' }),
    ).toThrow("unsupported distro for Docker's apt repo: fedora");
    expect(() => dockerRepoTarget({})).toThrow(
      "unsupported distro for Docker's apt repo: unknown",
    );
  });

  it('rejects a missing or unsafe codename', () => {
    expect(() => dockerRepoTarget({ ID: 'ubuntu' })).toThrow(
      'could not determine distro codename',
    );
    expect(() =>
      dockerRepoTarget({ ID: 'debian', VERSION_CODENAME: '$(reboot)' }),
    ).toThrow('invalid distro codename');
  });
});

describe('docker', () => {
  it('installs the engine and lazydocker with defaults (parity with install-toolchains.sh)', async () => {
    const { calls, warnings, urls } = await run();
    expect(calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'docker: engine'],
      ['root', 'docker: lazydocker'],
    ]);
    const engine = calls[0]?.script ?? '';
    for (const line of [
      "if dpkg -l docker.io 2>/dev/null | grep -q '^ii'; then",
      "curl -fsSL 'https://download.docker.com/linux/ubuntu/gpg' -o /etc/apt/keyrings/docker.asc",
      'chmod a+r /etc/apt/keyrings/docker.asc',
      [
        'cat > /etc/apt/sources.list.d/docker.sources <<EOF',
        'Types: deb',
        'URIs: https://download.docker.com/linux/ubuntu',
        'Suites: noble',
        'Components: stable',
        'Architectures: $(dpkg --print-architecture)',
        'Signed-By: /etc/apt/keyrings/docker.asc',
        'EOF',
      ].join('\n'),
      'apt-get update -y',
      'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
      'systemctl enable --now docker',
      "usermod -aG docker 'alice'",
      'docker --version',
    ]) {
      expect(engine).toContain(line);
    }
    expect(urls).toEqual([
      'https://api.github.com/repos/jesseduffield/lazydocker/releases/latest',
    ]);
    expect(warnings).toEqual([]);
    expect(calls).toMatchSnapshot();
  });

  it('uses the debian repo on debian', async () => {
    const { calls } = await run(
      { addons: [] },
      { os: { ID: 'debian', VERSION_CODENAME: 'trixie' } },
    );
    expect(calls[0]?.script).toContain(
      'URIs: https://download.docker.com/linux/debian\nSuites: trixie',
    );
  });

  it('throws on an unsupported distro before running anything', async () => {
    await expect(run({}, { os: { ID: 'arch' } })).rejects.toThrow(
      'unsupported distro',
    );
  });

  it('skips usermod when group=false', async () => {
    const { calls } = await run({ group: false, addons: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.script).not.toContain('usermod');
  });

  it('quotes the user name', async () => {
    vi.spyOn(dockerDeps, 'osRelease').mockReturnValue(UBUNTU);
    const runner = new RecordingRunner();
    const ic = createInstallContext({
      runner,
      ctx: { isRoot: true, user: "o'neil", home: '/home/oneil' },
      logger,
      exists: () => true,
    });
    await docker.install(ic, { group: true, addons: [] });
    expect(runner.calls[0]?.script).toContain(
      `usermod -aG docker 'o'\\''neil'`,
    );
  });

  it('warns instead of enabling the service without systemd', async () => {
    const { calls, warnings } = await run({ addons: [] }, { systemd: false });
    expect(calls[0]?.script).not.toContain('systemctl');
    expect(warnings).toEqual(['systemd not running; start dockerd manually']);
  });

  it('needs apt', async () => {
    await expect(run({}, { apt: false })).rejects.toThrow('docker needs apt');
  });

  it('fails the toolchain when the engine step fails', async () => {
    await expect(run({}, { fail: ['docker: engine'] })).rejects.toThrow(
      'docker: engine',
    );
  });

  it.each(['amd64', 'arm64'] as const)(
    'installs every add-on with verified asset names (%s)',
    async (cpu) => {
      const { calls, warnings } = await run(allAddons, { cpu });
      expect(calls.map((c) => c.label)).toEqual([
        'docker: engine',
        'docker: lazydocker',
        'docker: dive',
        'docker: hadolint',
      ]);
      const [, lazy, dive, hadolint] = calls.map((c) => c.script);
      const gnuArch = cpu === 'amd64' ? 'x86_64' : 'arm64';
      expect(lazy).toContain(
        `https://github.com/jesseduffield/lazydocker/releases/download/v0.25.2/lazydocker_0.25.2_Linux_${gnuArch}.tar.gz`,
      );
      expect(lazy).toContain(
        'https://github.com/jesseduffield/lazydocker/releases/download/v0.25.2/checksums.txt',
      );
      expect(dive).toContain(
        `https://github.com/wagoodman/dive/releases/download/v0.13.1/dive_0.13.1_linux_${cpu}.tar.gz`,
      );
      expect(dive).toContain(
        'https://github.com/wagoodman/dive/releases/download/v0.13.1/dive_0.13.1_checksums.txt',
      );
      expect(hadolint).toContain(
        `https://github.com/hadolint/hadolint/releases/download/v2.15.1/hadolint-linux-${gnuArch}`,
      );
      expect(hadolint).toContain(
        'https://github.com/hadolint/hadolint/releases/download/v2.15.1/checksums.sha256',
      );
      expect(hadolint).not.toContain('tar -xzf');
      for (const script of [lazy, dive, hadolint])
        expect(script).toContain('sha256sum -c');
      expect(warnings).toEqual([]);
      expect(calls).toMatchSnapshot();
    },
  );

  it('falls back to pinned tags when GitHub is unreachable', async () => {
    const { calls, warnings } = await run(allAddons, { offline: true });
    expect(calls).toHaveLength(4);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain(
      'could not resolve the latest jesseduffield/lazydocker release',
    );
    expect(warnings[0]).toContain('using v0.25.2');
  });

  it('turns an add-on failure into a warning and continues', async () => {
    const { calls, warnings } = await run(allAddons, {
      fail: ['docker: dive'],
    });
    expect(calls.map((c) => c.label)).toContain('docker: hadolint');
    expect(warnings).toEqual([
      expect.stringMatching(
        /^docker add-on dive failed: step failed: docker: dive/,
      ),
    ]);
  });

  it('does not probe the architecture without add-ons', async () => {
    await run({ addons: [] });
    expect(dockerDeps.arch).not.toHaveBeenCalled();
  });

  it.skipIf(!hasBash)('produces scripts that pass bash -n', async () => {
    const cases: [Choices, RunOpts][] = [
      [{}, {}],
      [
        { ...allAddons, group: false },
        { systemd: false, cpu: 'arm64' },
      ],
    ];
    for (const [choices, opts] of cases) {
      const { calls } = await run(choices, opts);
      for (const c of calls) {
        const res = spawnSync('bash', ['-n', '-c', rootScript(c.script)], {
          encoding: 'utf8',
        });
        expect({
          label: c.label,
          status: res.status,
          stderr: res.stderr,
        }).toEqual({
          label: c.label,
          status: 0,
          stderr: '',
        });
      }
    }
  });
});
