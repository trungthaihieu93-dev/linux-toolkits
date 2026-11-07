import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  rootScript,
  userScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { rust } from './rust';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const noFetch = (() =>
  Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch;
const ALL: Choices = {
  toolchain: 'nightly',
  components: ['clippy', 'rustfmt', 'rust-analyzer'],
  addons: ['cargo-nextest', 'cargo-watch', 'cargo-edit'],
};

function run(
  overrides: Choices = {},
  opts: { fail?: string[]; apt?: boolean } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const apt = opts.apt ?? true;
  const ic = createInstallContext({
    runner,
    ctx,
    logger,
    fetch: noFetch,
    exists: (p) => apt && p === '/usr/bin/apt-get',
    listDir: () => [],
  });
  return {
    runner,
    ic,
    done: rust.install(ic, mergeChoices(defaultsFor(rust), overrides)),
  };
}

describe('rust install', () => {
  it('defaults: build deps, rustup stable with all components, cargo-nextest (bash parity)', async () => {
    const { runner, ic, done } = run();
    await done;
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'rust: build deps'],
      ['user', 'rust: rustup'],
      ['user', 'rust: cargo-nextest'],
    ]);
    const [deps, rustup, nextest] = runner.calls.map((c) => c.script);
    expect(deps).toContain(
      "apt-get install -y --no-install-recommends 'build-essential' 'pkg-config' 'libssl-dev'",
    );
    expect(rustup).toContain('rustup self update || true');
    expect(rustup).toContain("rustup update 'stable'");
    expect(rustup).toContain(
      'https://sh.rustup.rs | sh -s -- -y --profile default',
    );
    expect(rustup).toContain('. "$HOME/.cargo/env"\nrustup default \'stable\'');
    expect(rustup).toContain(
      "rustup component add 'clippy' 'rustfmt' 'rust-analyzer'",
    );
    expect(rustup).toContain('rustc --version; cargo --version');
    expect(nextest).toBe("cargo install --locked 'cargo-nextest'");
    expect(ic.warnings).toEqual([]);
  });

  it('all options: nightly toolchain, every add-on', async () => {
    const { runner, done } = run(ALL);
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'rust: build deps',
      'rust: rustup',
      'rust: cargo-nextest',
      'rust: cargo-watch',
      'rust: cargo-edit',
    ]);
    expect(runner.calls[1]?.script).toContain("--default-toolchain 'nightly'");
    expect(runner.calls[1]?.script).toContain("rustup default 'nightly'");
  });

  it('no components: no component add', async () => {
    const { runner, done } = run({ components: [], addons: [] });
    await done;
    expect(runner.calls[1]?.script).not.toContain('component add');
  });

  it('without apt: warns about the linker and still installs', async () => {
    const { runner, ic, done } = run({}, { apt: false });
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'rust: rustup',
      'rust: cargo-nextest',
    ]);
    expect(ic.warnings).toEqual([
      'rust: no apt: make sure a C linker (gcc/cc) is installed',
    ]);
  });

  it('an add-on failure becomes a warning and the install still resolves', async () => {
    const { runner, ic, done } = run(ALL, { fail: ['rust: cargo-watch'] });
    await expect(done).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.label).toBe('rust: cargo-edit');
    expect(ic.warnings).toEqual([
      expect.stringMatching(/^rust: add-on cargo-watch failed: /),
    ]);
  });

  it('a rustup failure rejects', async () => {
    const { done } = run({}, { fail: ['rust: rustup'] });
    await expect(done).rejects.toThrow('rust: rustup');
  });

  it.skipIf(!hasBash)('every script parses with bash -n', async () => {
    const { runner, done } = run(ALL);
    await done;
    for (const call of runner.calls) {
      const res = spawnSync('bash', ['-n'], {
        input:
          call.as === 'root'
            ? rootScript(call.script)
            : userScript(call.script),
      });
      expect(res.status, `${call.label}: ${res.stderr}`).toBe(0);
    }
  });
});
