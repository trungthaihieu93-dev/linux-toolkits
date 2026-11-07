import { addRcBlock, aptInstall } from '@linux-toolchain/core';
import { choiceList } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { requireApt, tryAddon } from './shared';

const COMPILER_PACKAGES: Record<string, readonly string[]> = {
  gcc: ['build-essential', 'gcc', 'g++', 'gdb'],
  clang: ['clang', 'clangd', 'clang-format', 'clang-tidy', 'lld', 'lldb'],
};

const BUILD_PACKAGES: Record<string, readonly string[]> = {
  'cmake-ninja': ['cmake', 'ninja-build'],
  meson: ['meson'],
  make: ['make'],
};

/** Installed whatever the compiler/build choices are. */
const COMMON_PACKAGES = [
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
] as const;

const VERSION_COMMANDS: Record<string, string> = {
  gcc: 'gcc --version | head -n1',
  clang: 'clang --version | head -n1',
};

/** Apt packages for the chosen compilers and build systems, de-duplicated, in a stable order. */
export function cppPackages(
  compilers: readonly string[],
  build: readonly string[],
): string[] {
  const lookup = (
    table: Record<string, readonly string[]>,
    value: string,
    what: string,
  ) => {
    const pkgs = table[value];
    if (!pkgs) throw new Error(`cpp: unknown ${what}: ${value}`);
    return pkgs;
  };
  return [
    ...new Set([
      ...compilers.flatMap((c) => lookup(COMPILER_PACKAGES, c, 'compiler')),
      ...build.flatMap((b) => lookup(BUILD_PACKAGES, b, 'build system')),
      ...COMMON_PACKAGES,
    ]),
  ];
}

const CONAN_SCRIPT = [
  'if command -v uv >/dev/null 2>&1; then',
  '  uv tool install conan',
  'elif command -v pipx >/dev/null 2>&1; then',
  '  pipx install conan',
  'else',
  "  echo 'conan needs uv or pipx (install the python component first)' >&2",
  '  exit 1',
  'fi',
].join('\n');

const VCPKG_SCRIPT = [
  'if [ -d "$HOME/.vcpkg/.git" ]; then',
  '  git -C "$HOME/.vcpkg" pull --ff-only',
  'else',
  '  git clone https://github.com/microsoft/vcpkg "$HOME/.vcpkg"',
  'fi',
  '"$HOME/.vcpkg/bootstrap-vcpkg.sh" -disableMetrics',
  addRcBlock(
    'vcpkg',
    'export VCPKG_ROOT="$HOME/.vcpkg"\nexport PATH="$VCPKG_ROOT:$PATH"',
  ),
].join('\n');

/** One add-on = one or more runner steps; a failure becomes a warning. */
async function installAddon(ic: InstallContext, addon: string): Promise<void> {
  switch (addon) {
    case 'cppcheck':
      return ic.runner.asRoot(aptInstall(['cppcheck']), 'cpp: cppcheck');
    case 'conan':
      return ic.runner.asUser(CONAN_SCRIPT, 'cpp: conan');
    case 'vcpkg':
      // bootstrap-vcpkg.sh downloads with curl; vcpkg itself needs zip/unzip/tar.
      await ic.runner.asRoot(
        aptInstall(['git', 'curl', 'zip', 'unzip', 'tar']),
        'cpp: vcpkg prerequisites',
      );
      return ic.runner.asUser(VCPKG_SCRIPT, 'cpp: vcpkg');
    default:
      throw new Error(`unknown add-on: ${addon}`);
  }
}

/**
 * Option keys:
 * - compilers multi gcc | clang                  (default [gcc, clang])
 * - build     multi cmake-ninja | meson | make   (default [cmake-ninja, meson, make])
 *   make is always installed (build-essential needs it, autotools use it).
 * - addons    multi cppcheck | conan | vcpkg     (default [cppcheck])
 *   cppcheck via apt; conan via `uv tool install` (pipx fallback); vcpkg cloned to ~/.vcpkg.
 */
export const cpp: Toolchain = {
  id: 'cpp',
  label: 'C/C++',
  description: 'gcc, g++, clang, lld, gdb, cmake, ninja, make, ccache, ...',
  options: [
    {
      key: 'compilers',
      kind: 'multi',
      label: 'Compilers',
      choices: [
        { value: 'gcc', label: 'GCC', hint: 'gcc, g++, gdb' },
        {
          value: 'clang',
          label: 'Clang/LLVM',
          hint: 'clang, clangd, lld, lldb',
        },
      ],
      default: ['gcc', 'clang'],
    },
    {
      key: 'build',
      kind: 'multi',
      label: 'Build systems',
      choices: [
        { value: 'cmake-ninja', label: 'CMake + Ninja' },
        { value: 'meson', label: 'Meson' },
        { value: 'make', label: 'Make' },
      ],
      default: ['cmake-ninja', 'meson', 'make'],
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'cppcheck', label: 'cppcheck', hint: 'apt' },
        { value: 'conan', label: 'conan', hint: 'uv tool install' },
        { value: 'vcpkg', label: 'vcpkg', hint: '~/.vcpkg' },
      ],
      default: ['cppcheck'],
    },
  ],
  async install(ic, choices) {
    requireApt(ic, 'cpp');
    const compilers = choiceList(choices, 'compilers');
    const build = choiceList(choices, 'build');
    const addons = choiceList(choices, 'addons');

    ic.logger.log('Installing C/C++ toolchains');
    const versions = compilers
      .map((c) => VERSION_COMMANDS[c])
      .filter((cmd): cmd is string => Boolean(cmd));
    await ic.runner.asRoot(
      [aptInstall(cppPackages(compilers, build)), ...versions].join('\n'),
      'cpp: packages',
    );

    for (const addon of addons) {
      await tryAddon(ic, `cpp add-on ${addon}`, () => installAddon(ic, addon));
    }
  },
};
