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
import { cpp, cppPackages } from './cpp';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };

/** The package list install_cpp in install-toolchains.sh installs. */
const BASH_PACKAGES = [
  'build-essential',
  'gcc',
  'g++',
  'make',
  'clang',
  'clangd',
  'clang-format',
  'clang-tidy',
  'lld',
  'lldb',
  'gdb',
  'cmake',
  'ninja-build',
  'meson',
  'pkg-config',
  'autoconf',
  'automake',
  'libtool',
  'bison',
  'flex',
  'ccache',
  'valgrind',
  'binutils',
  'gdb-multiarch',
];

async function run(
  overrides: Choices = {},
  opts: { apt?: boolean; fail?: string[] } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const ic = createInstallContext({
    runner,
    ctx,
    logger,
    exists: (p) => p === '/usr/bin/apt-get' && opts.apt !== false,
    listDir: () => [],
    fetch: (() =>
      Promise.reject(new Error('no network in tests'))) as typeof fetch,
  });
  await cpp.install(ic, mergeChoices(defaultsFor(cpp), overrides));
  return { calls: runner.calls, warnings: ic.warnings };
}

const all: Choices = {
  compilers: ['gcc', 'clang'],
  build: ['cmake-ninja', 'meson', 'make'],
  addons: ['cppcheck', 'conan', 'vcpkg'],
};

describe('cpp', () => {
  it('defaults to the bash build-system list', () => {
    expect(defaultsFor(cpp)['build']).toEqual(['cmake-ninja', 'meson', 'make']);
  });

  it('default choices install the same apt set as install-toolchains.sh (parity)', () => {
    const d = defaultsFor(cpp);
    const pkgs = cppPackages(
      d['compilers'] as string[],
      d['build'] as string[],
    );
    expect(new Set(pkgs)).toEqual(new Set(BASH_PACKAGES));
    expect(pkgs).toHaveLength(new Set(pkgs).size);
  });

  it('maps each choice to its packages', () => {
    expect(cppPackages(['gcc'], ['meson'])).toEqual([
      'build-essential',
      'gcc',
      'g++',
      'gdb',
      'meson',
      'pkg-config',
      'autoconf',
      'automake',
      'libtool',
      'bison',
      'flex',
      'ccache',
      'valgrind',
      'binutils',
      'gdb-multiarch',
      'make',
    ]);
    const clangOnly = cppPackages(['clang'], []);
    expect(clangOnly).toContain('lldb');
    expect(clangOnly).not.toContain('gcc');
    expect(clangOnly).not.toContain('cmake');
    expect(clangOnly).toContain('make');
    expect(() => cppPackages(['icc'], [])).toThrow(/unknown compiler: icc/);
  });

  it('installs packages and prints versions with defaults', async () => {
    const { calls, warnings } = await run();
    expect(calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'cpp: packages'],
      ['root', 'cpp: cppcheck'],
    ]);
    expect(calls[0]?.script).toContain('gcc --version | head -n1');
    expect(calls[0]?.script).toContain('clang --version | head -n1');
    expect(warnings).toEqual([]);
    expect(calls).toMatchSnapshot();
  });

  it('prints only the selected compiler version', async () => {
    const { calls } = await run({ compilers: ['clang'], addons: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.script).toContain('clang --version');
    expect(calls[0]?.script).not.toContain('gcc --version');
    expect(calls[0]?.script).not.toContain("'build-essential'");
  });

  it('installs every add-on when all are chosen', async () => {
    const { calls, warnings } = await run(all);
    expect(calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'cpp: packages'],
      ['root', 'cpp: cppcheck'],
      ['user', 'cpp: conan'],
      ['root', 'cpp: vcpkg prerequisites'],
      ['user', 'cpp: vcpkg'],
    ]);
    const conan = calls[2]?.script ?? '';
    expect(conan).toContain('uv tool install conan');
    expect(conan).toContain('pipx install conan');
    const vcpkg = calls[4]?.script ?? '';
    expect(vcpkg).toContain(
      'git clone https://github.com/microsoft/vcpkg "$HOME/.vcpkg"',
    );
    expect(vcpkg).toContain('bootstrap-vcpkg.sh" -disableMetrics');
    expect(vcpkg).toContain('VCPKG_ROOT');
    expect(warnings).toEqual([]);
    expect(calls).toMatchSnapshot();
  });

  it('turns an add-on failure into a warning and continues', async () => {
    const { calls, warnings } = await run(all, { fail: ['cpp: conan'] });
    expect(calls.map((c) => c.label)).toContain('cpp: vcpkg');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /cpp add-on conan failed: step failed: cpp: conan/,
    );
  });

  it('skips vcpkg when its prerequisites fail', async () => {
    const { calls, warnings } = await run(
      { addons: ['vcpkg'] },
      { fail: ['cpp: vcpkg prerequisites'] },
    );
    expect(calls.map((c) => c.label)).not.toContain('cpp: vcpkg');
    expect(warnings[0]).toMatch(/cpp add-on vcpkg failed/);
  });

  it('fails the toolchain when the package step fails', async () => {
    await expect(run({}, { fail: ['cpp: packages'] })).rejects.toThrow(
      /cpp: packages/,
    );
  });

  it('needs apt', async () => {
    await expect(run({}, { apt: false })).rejects.toThrow(/cpp needs apt/);
  });

  it.skipIf(!hasBash)('produces scripts that pass bash -n', async () => {
    for (const choices of [{}, all]) {
      const { calls } = await run(choices);
      for (const c of calls) {
        const wrapped =
          c.as === 'root' ? rootScript(c.script) : userScript(c.script);
        const res = spawnSync('bash', ['-n', '-c', wrapped], {
          encoding: 'utf8',
        });
        expect({
          label: c.label,
          status: res.status,
          stderr: res.stderr,
        }).toEqual({ label: c.label, status: 0, stderr: '' });
      }
    }
  });
});
