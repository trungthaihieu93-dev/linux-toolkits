import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const bundle = resolve(
  import.meta.dirname,
  '../../../dist/apps/linux-toolchain/main.js',
);

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [bundle, ...args], {
    encoding: 'utf8',
    // No TTY: stdin is closed, so the CLI never prompts.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 170_000,
  });
  if (result.error) throw result.error;
  return result;
}

describe('linux-toolchain bundle', () => {
  beforeAll(() => {
    if (!existsSync(bundle)) {
      throw new Error(
        `bundle not found at ${bundle}; run \`nx run linux-toolchain:e2e\` (it builds first)`,
      );
    }
  });

  it('dry-runs every toolchain with defaults and exits 0', () => {
    const { status, stdout, stderr } = cli(
      '--all',
      '--defaults',
      '-y',
      '--dry-run',
    );
    expect(status, stderr).toBe(0);
    expect(stdout).toMatch(/^\[root\] /m);
    expect(stdout).toMatch(/^\[user\] /m);
    expect(stdout).toContain('Dry run: printing the scripts');
    expect(stdout).toMatch(/ok: +nvm-bun bun-tools go rust python pyenv java/);
    expect(stdout).not.toContain('failed:');
  });

  it('honours flags after the `install` subcommand', () => {
    const { status, stdout, stderr } = cli(
      'install',
      '--dry-run',
      '--only',
      'go',
      '--defaults',
      '-y',
    );
    expect(status, stderr).toBe(0);
    expect(stdout).toMatch(/^\[root\] /m);
    expect(stdout).toContain('Dry run: printing the scripts');
  });

  it('lists 13 toolchains as JSON', () => {
    const { status, stdout } = cli('list', '--json');
    expect(status).toBe(0);
    const entries = JSON.parse(stdout) as { id: string }[];
    expect(entries).toHaveLength(13);
  });

  it('documents every flag in --help', () => {
    const { status, stdout } = cli('--help');
    expect(status).toBe(0);
    for (const flag of [
      '--all',
      '--only',
      '--opt',
      '--defaults',
      '--user',
      '--yes',
      '--dry-run',
      '--version',
      '--help',
      'list',
      'install',
    ]) {
      expect(stdout).toContain(flag);
    }
  });

  it('exits 2 on a usage error', () => {
    const { status, stderr } = cli('--all', 'go');
    expect(status).toBe(2);
    expect(stderr).toContain('--all cannot be combined');
  });
});
