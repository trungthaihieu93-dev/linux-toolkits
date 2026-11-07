import {
  addRcBlock,
  aptInstall,
  shQuote,
  writeProfile,
} from '@linux-toolchain/core';
import { choiceList, choiceString } from '../options';
import type { Toolchain } from '../types';
import { requireApt, tryAddon } from './shared';

export const FLUTTER_DIR = '/opt/flutter';
export const ANDROID_SDK_DIR = '/opt/android-sdk';
const FLUTTER_REPO = 'https://github.com/flutter/flutter.git';

/** Prefix for user scripts that call the flutter/dart binaries of the shared SDK. */
export const FLUTTER_ENV = `export PATH=${FLUTTER_DIR}/bin:$PATH`;

/** User script: point Flutter at the Android SDK when both are installed (either order). */
export const LINK_ANDROID_SDK = [
  `if [ -x ${FLUTTER_DIR}/bin/flutter ] && [ -x ${ANDROID_SDK_DIR}/cmdline-tools/latest/bin/sdkmanager ]; then`,
  `  ${FLUTTER_ENV}`,
  `  flutter config --android-sdk ${ANDROID_SDK_DIR}`,
  'fi',
].join('\n');

const PREREQUISITES = [
  'curl',
  'git',
  'unzip',
  'xz-utils',
  'zip',
  'ca-certificates',
  'libglu1-mesa',
  'clang',
  'cmake',
  'ninja-build',
  'pkg-config',
  'libgtk-3-dev',
  'liblzma-dev',
  'libstdc++-12-dev',
  'libsecret-1-dev',
];

const PUB_CACHE_PATH =
  'case ":$PATH:" in *:"$HOME/.pub-cache/bin":*) ;; *) export PATH="$PATH:$HOME/.pub-cache/bin" ;; esac';

/**
 * Option keys:
 * - channel select stable | beta              (default stable)
 * - addons  multi  android-sdk | web | fvm    (default [fvm])
 *   android-sdk selects the `android` component (see addonImplies) — not installed here;
 *   web = `flutter config --enable-web`; fvm = `dart pub global activate fvm`.
 */
export const flutter: Toolchain = {
  id: 'flutter',
  label: 'Flutter SDK',
  description:
    'Flutter (stable/beta) -> /opt/flutter + Linux desktop build tools',
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
        {
          value: 'android-sdk',
          label: 'Android SDK',
          hint: 'selects the android component',
        },
        {
          value: 'web',
          label: 'Web support',
          hint: 'flutter config --enable-web',
        },
        { value: 'fvm', label: 'fvm', hint: 'Flutter version manager' },
      ],
      default: ['fvm'],
    },
  ],
  async install(ic, choices) {
    requireApt(ic, 'flutter');
    const channel = choiceString(choices, 'channel');
    const addons = choiceList(choices, 'addons');
    const user = shQuote(ic.ctx.user);

    ic.logger.log('Installing Flutter build prerequisites');
    await ic.runner.asRoot(
      aptInstall(PREREQUISITES),
      'install Flutter build prerequisites',
    );

    // Owned by the target user: Flutter writes its cache inside the SDK directory.
    if (ic.exists(`${FLUTTER_DIR}/.git`)) {
      ic.logger.log(
        `Flutter already present, switching to ${channel} and upgrading`,
      );
      await ic.runner.asUser(
        `${FLUTTER_ENV}\nflutter channel ${shQuote(channel)}\nflutter upgrade`,
        `upgrade Flutter (${channel})`,
      );
    } else {
      ic.logger.log(`Cloning Flutter (${channel}) into ${FLUTTER_DIR}`);
      await ic.runner.asRoot(
        `install -d -o ${user} ${FLUTTER_DIR}`,
        `create ${FLUTTER_DIR}`,
      );
      await ic.runner.asUser(
        `git clone -b ${shQuote(channel)} ${FLUTTER_REPO} ${FLUTTER_DIR}`,
        `clone Flutter (${channel})`,
      );
    }
    await ic.runner.asRoot(
      [
        `chown -R ${user} ${FLUTTER_DIR}`,
        writeProfile(
          'flutter',
          `case ":$PATH:" in *:${FLUTTER_DIR}/bin:*) ;; *) export PATH="$PATH:${FLUTTER_DIR}/bin" ;; esac`,
        ),
      ].join('\n'),
      'configure Flutter ownership and PATH',
    );
    await ic.runner.asUser(
      `${FLUTTER_ENV}\nflutter precache\nflutter --version`,
      'precache Flutter',
    );
    await ic.runner.asUser(
      LINK_ANDROID_SDK,
      'link Flutter to the Android SDK if present',
    );

    if (addons.includes('web')) {
      await tryAddon(ic, 'flutter add-on web', () =>
        ic.runner.asUser(
          `${FLUTTER_ENV}\nflutter config --enable-web`,
          'enable Flutter web support',
        ),
      );
    }
    if (addons.includes('fvm')) {
      await tryAddon(ic, 'flutter add-on fvm', () =>
        ic.runner.asUser(
          [
            `${FLUTTER_ENV}`,
            'dart pub global activate fvm',
            addRcBlock('pub-cache', PUB_CACHE_PATH),
          ].join('\n'),
          'install fvm',
        ),
      );
    }
  },
};
