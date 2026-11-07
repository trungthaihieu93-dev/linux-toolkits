import chalk from 'chalk';
import { catalog } from '@linux-toolchain/toolchains';
import pkg from '../../package.json' with { type: 'json' };
import { spyCatalog, testDeps } from '../testing/helpers';
import { runInstall } from './install';
import type { RunConfig } from './options';
import { run } from './program';

// Call through to the real runInstall, recording the RunConfig it receives.
vi.mock('./install', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./install')>();
  return { ...actual, runInstall: vi.fn(actual.runInstall) };
});

beforeAll(() => {
  chalk.level = 0;
});

beforeEach(() => {
  vi.mocked(runInstall).mockClear();
});

function lastConfig(): RunConfig {
  const calls = vi.mocked(runInstall).mock.calls;
  expect(calls).toHaveLength(1);
  return (calls[0] as [RunConfig, unknown])[0];
}

describe('run', () => {
  it('prints help with every install flag and the commands', async () => {
    const deps = testDeps();
    expect(await run(['--help'], deps)).toBe(0);
    for (const flag of [
      '--all',
      '--only <ids>',
      '--opt <key=value>',
      '--defaults',
      '--user <name>',
      '-y, --yes',
      '--dry-run',
      '--version',
      'install [options] [ids...]',
      'list [options]',
    ]) {
      expect(deps.out.text).toContain(flag);
    }
  });

  it('prints the version', async () => {
    const deps = testDeps();
    expect(await run(['--version'], deps)).toBe(0);
    expect(deps.out.text.trim()).toBe(pkg.version);
  });

  it('lists the catalog as JSON', async () => {
    const deps = testDeps();
    expect(await run(['list', '--json'], deps)).toBe(0);
    const entries = JSON.parse(deps.out.text) as { id: string }[];
    expect(entries.map((e) => e.id)).toEqual(catalog.map((t) => t.id));
    expect(entries).toHaveLength(13);
  });

  it('lists the catalog as text with option keys', async () => {
    const deps = testDeps();
    expect(await run(['list'], deps)).toBe(0);
    expect(deps.out.text).toContain('java.jdk list of 17|21|25 (default 21)');
    expect(deps.out.text).toContain('docker.group true|false (default true)');
  });

  it('exits 2 on usage errors', async () => {
    for (const argv of [
      ['--bogus'],
      ['--all', 'go'],
      ['nope'],
      ['--opt', 'java.jdk=8', 'java'],
      ['--only'],
      ['--only', 'go', '--opt', 'java.jdk=17', '-y'],
      ['--only', 'bun-tools', '--opt', 'nvm-bun.bun=false', '-y'],
    ]) {
      const deps = testDeps();
      expect(await run(argv, deps), argv.join(' ')).toBe(2);
      expect(deps.err.text, argv.join(' ')).not.toBe('');
    }
  });

  it('runs the install as the default command and via `install`', async () => {
    for (const argv of [
      ['--only', 'go', '-y'],
      ['go', '--yes'],
      ['install', 'go', '-y'],
    ]) {
      const { catalog: spy, installed } = spyCatalog();
      const deps = testDeps({ catalog: spy });
      expect(await run(argv, deps), argv.join(' ')).toBe(0);
      expect([...installed.keys()], argv.join(' ')).toEqual(['go']);
    }
  });

  it('honours install flags before, after and around the `install` subcommand', async () => {
    const cases: {
      argv: string[];
      expected: Partial<RunConfig> & { opt?: Record<string, unknown> };
    }[] = [
      {
        argv: ['install', '--dry-run', 'go', '-y'],
        expected: { ids: ['go'], dryRun: true, yes: true },
      },
      {
        argv: ['--dry-run', 'install', 'go', '-y'],
        expected: { ids: ['go'], dryRun: true, yes: true },
      },
      {
        argv: ['install', 'go', '--user', 'bob', '-y'],
        expected: { ids: ['go'], user: 'bob', yes: true, dryRun: false },
      },
      {
        argv: ['install', '--only', 'go', '--opt', 'go.addons=gopls', '-y'],
        expected: {
          ids: ['go'],
          yes: true,
          opt: { go: { addons: ['gopls'] } },
        },
      },
      {
        argv: [
          '--opt',
          'go.addons=gopls',
          'install',
          'go',
          'java',
          '--opt',
          'java.jdk=17',
          '-y',
        ],
        expected: {
          ids: ['go', 'java'],
          yes: true,
          opt: {
            go: { addons: ['gopls'] },
            java: { jdk: ['17'] },
          },
        },
      },
      {
        argv: ['install', '--all', '--defaults', '-y', '--dry-run'],
        expected: {
          ids: catalog.map((t) => t.id),
          defaults: true,
          yes: true,
          dryRun: true,
        },
      },
    ];
    for (const { argv, expected } of cases) {
      vi.mocked(runInstall).mockClear();
      const { catalog: spy } = spyCatalog();
      const users: (string | undefined)[] = [];
      const runners: boolean[] = [];
      const deps = testDeps({ catalog: spy, tty: true });
      const base = deps.createRunner;
      deps.createRunner = (ctx, dryRun) => {
        runners.push(dryRun);
        return base(ctx, dryRun);
      };
      deps.resolveContext = (user) => {
        users.push(user);
        return { isRoot: true, user: user ?? 'dev', home: '/home/dev' };
      };
      const label = argv.join(' ');
      expect(await run(argv, deps), `${label}: ${deps.err.text}`).toBe(0);
      const config = lastConfig();
      const { opt, ...fields } = expected;
      expect(config, label).toMatchObject(fields);
      expect(Object.fromEntries(config.overrides), label).toEqual(opt ?? {});
      // -y reached the run: with a TTY nothing was asked (no review confirm).
      expect(deps.prompts.calls, label).toEqual([]);
      expect(runners, label).toEqual([config.dryRun]);
      expect(users, label).toEqual([config.user]);
    }
  });

  it('collects repeated --opt flags', async () => {
    const { catalog: spy, installed } = spyCatalog();
    const deps = testDeps({ catalog: spy });
    const code = await run(
      [
        '--only',
        'java,go',
        '--opt',
        'java.jdk=17,21',
        '--opt',
        'java.addons=maven,gradle',
        '-y',
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(installed.get('java')?.choices).toEqual({
      jdk: ['17', '21'],
      default: '21',
      addons: ['maven', 'gradle'],
    });
  });

  it('exits 130 when a prompt is cancelled with Ctrl+C', async () => {
    const deps = testDeps({ tty: true });
    deps.prompts.checkbox = async () => {
      const error = new Error('User force closed the prompt');
      error.name = 'ExitPromptError';
      throw error;
    };
    expect(await run([], deps)).toBe(130);
    expect(deps.err.text).toContain('cancelled');
  });
});
