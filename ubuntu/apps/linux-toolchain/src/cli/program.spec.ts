import chalk from 'chalk';
import { catalog } from '@linux-toolchain/toolchains';
import pkg from '../../package.json' with { type: 'json' };
import { spyCatalog, testDeps } from '../testing/helpers';
import { run } from './program';

beforeAll(() => {
  chalk.level = 0;
});

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
