import type { Toolchain } from '../types';

/**
 * Option keys:
 * - channel select stable | beta              (default stable)
 * - addons  multi  android-sdk | web | fvm    (default [fvm])
 *   android-sdk selects the `android` component (see addonImplies) — do not install it here;
 *   web = `flutter config --enable-web`; fvm = Flutter version manager.
 */
export const flutter: Toolchain = {
  id: 'flutter',
  label: 'Flutter SDK',
  description: 'Flutter (stable) -> /opt/flutter + Linux desktop build tools',
  addonImplies: { 'android-sdk': 'android' },
  options: [
    {
      key: 'channel',
      kind: 'select',
      label: 'Channel',
      choices: [
        { value: 'stable', label: 'stable' },
        { value: 'beta', label: 'beta' },
      ],
      default: 'stable',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'android-sdk', label: 'Android SDK', hint: 'selects the android component' },
        { value: 'web', label: 'Web support', hint: 'flutter config --enable-web' },
        { value: 'fvm', label: 'fvm', hint: 'Flutter version manager' },
      ],
      default: ['fvm'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
