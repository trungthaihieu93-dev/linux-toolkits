import type { Toolchain } from '../types';

/**
 * Option keys:
 * - platforms   select latest | latest-and-previous   (default latest; `platforms;android-N`)
 * - build-tools select latest                         (default latest)
 * - addons      multi  emulator | ndk | cmake         (default []; all via sdkmanager)
 *   emulator = emulator + a system image for the latest platform.
 * Licenses need explicit consent: prompt, or `ic.yes`; never accept silently.
 */
export const android: Toolchain = {
  id: 'android',
  label: 'Android SDK',
  description: 'JDK + cmdline-tools/platform-tools/build-tools -> /opt/android-sdk',
  options: [
    {
      key: 'platforms',
      kind: 'select',
      label: 'Platforms',
      choices: [
        { value: 'latest', label: 'Latest' },
        { value: 'latest-and-previous', label: 'Latest + previous' },
      ],
      default: 'latest',
    },
    {
      key: 'build-tools',
      kind: 'select',
      label: 'Build tools',
      choices: [{ value: 'latest', label: 'Latest' }],
      default: 'latest',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'emulator', label: 'Emulator + system image' },
        { value: 'ndk', label: 'NDK' },
        { value: 'cmake', label: 'CMake' },
      ],
      default: [],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
