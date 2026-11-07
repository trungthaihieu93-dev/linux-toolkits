import type { Toolchain } from '../types';

/**
 * Option keys:
 * - compilers multi gcc | clang                  (default [gcc, clang])
 * - build     multi cmake-ninja | meson | make   (default [cmake-ninja])
 *   build-essential (and therefore make) is always installed with gcc.
 * - addons    multi cppcheck | conan | vcpkg     (default [cppcheck])
 *   cppcheck via apt; conan via `uv tool install`; vcpkg cloned to ~/.vcpkg.
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
        { value: 'clang', label: 'Clang/LLVM', hint: 'clang, clangd, lld, lldb' },
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
      default: ['cmake-ninja'],
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
  async install() {
    throw new Error('not implemented');
  },
};
