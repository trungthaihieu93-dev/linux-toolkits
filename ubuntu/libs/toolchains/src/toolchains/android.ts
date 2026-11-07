import { aptInstall, shQuote, writeProfile } from '@linux-toolchain/core';
import { choiceList, choiceString } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { ANDROID_SDK_DIR, LINK_ANDROID_SDK } from './flutter';
import { errorMessage, requireApt, tryAddon } from './shared';

/** Used when the cmdline-tools zip name cannot be scraped from developer.android.com (same as the bash script). */
export const CMDLINE_TOOLS_FALLBACK =
  'commandlinetools-linux-11076708_latest.zip';
const STUDIO_URL = 'https://developer.android.com/studio';
const CMDLINE_TOOLS_RE = /commandlinetools-linux-(\d+)_latest\.zip/g;

export const LICENSE_ERROR =
  'Android SDK licenses must be accepted (https://developer.android.com/studio/terms): re-run with -y to accept them';

/** Newest `commandlinetools-linux-<n>_latest.zip` linked from the Android Studio page; warns and falls back on failure. */
export async function latestCmdlineTools(ic: InstallContext): Promise<string> {
  let reason: string;
  try {
    const res = await ic.fetch(STUDIO_URL, {
      headers: { 'User-Agent': 'linux-toolchain' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const builds = [...(await res.text()).matchAll(CMDLINE_TOOLS_RE)].map(
        (m) => Number(m[1]),
      );
      if (builds.length > 0)
        return `commandlinetools-linux-${Math.max(...builds)}_latest.zip`;
      reason = 'no commandlinetools link on the page';
    } else {
      reason = `HTTP ${res.status}`;
    }
  } catch (error) {
    reason = errorMessage(error);
  }
  ic.warn(
    `could not detect the latest Android cmdline-tools (${reason}); using ${CMDLINE_TOOLS_FALLBACK}`,
  );
  return CMDLINE_TOOLS_FALLBACK;
}

/** User-script prelude: sdkmanager location and its package list. */
const SDK_ENV = [
  `export ANDROID_HOME=${ANDROID_SDK_DIR}`,
  'sdkm="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"',
  'list=$("$sdkm" --list 2>/dev/null)',
].join('\n');

/**
 * Shell assigning the newest package matching `patternWord` (an already-quoted ERE
 * ending in a space, as in `sdkmanager --list` rows) from $list to `variable`; exits 1 if none.
 */
function newest(variable: string, patternWord: string, what: string): string {
  return [
    `${variable}=$(printf '%s\\n' "$list" | grep -oE ${patternWord} | sort -uV | tail -n1 | tr -d ' ')`,
    `[ -n "$${variable}" ] || { echo ${shQuote(`could not find ${what} in sdkmanager --list`)} >&2; exit 1; }`,
  ].join('\n');
}

function cmdlineToolsScript(zip: string, user: string): string {
  if (!/^commandlinetools-linux-\d+_latest\.zip$/.test(zip))
    throw new Error(`invalid cmdline-tools zip: ${zip}`);
  return [
    '(',
    'set -e',
    'tmp=$(mktemp -d)',
    `trap 'rm -rf "$tmp"' EXIT`,
    `curl -fsSL --retry 3 -o "$tmp/cmdline.zip" ${shQuote(`https://dl.google.com/android/repository/${zip}`)}`,
    'unzip -q "$tmp/cmdline.zip" -d "$tmp"',
    `rm -rf ${ANDROID_SDK_DIR}/cmdline-tools/latest`,
    `install -d ${ANDROID_SDK_DIR}/cmdline-tools`,
    `mv "$tmp/cmdline-tools" ${ANDROID_SDK_DIR}/cmdline-tools/latest`,
    ')',
    `chown -R ${shQuote(user)} ${ANDROID_SDK_DIR}`,
  ].join('\n');
}

function sdkPackagesScript(previousPlatform: boolean): string {
  const platforms = previousPlatform ? 2 : 1;
  return [
    SDK_ENV,
    'yes | "$sdkm" --licenses >/dev/null || true',
    newest('bt', "'build-tools;[0-9]+\\.[0-9]+\\.[0-9]+ '", 'build-tools'),
    `mapfile -t pl < <(printf '%s\\n' "$list" | grep -oE 'platforms;android-[0-9]+ ' | sort -uV | tail -n${platforms} | tr -d ' ')`,
    `[ "\${#pl[@]}" -gt 0 ] || { echo 'could not find a platform in sdkmanager --list' >&2; exit 1; }`,
    'echo "Installing platform-tools $bt ${pl[*]}"',
    'yes | "$sdkm" "platform-tools" "$bt" "${pl[@]}"',
  ].join('\n');
}

/** Add-on user scripts, each resolving the newest matching sdkmanager package. */
const ADDON_SCRIPTS: Record<string, { label: string; script: string }> = {
  emulator: {
    label: 'install Android emulator + system image',
    script: [
      SDK_ENV,
      'case "$(uname -m)" in aarch64|arm64) abi=arm64-v8a ;; *) abi=x86_64 ;; esac',
      newest(
        'img',
        '"system-images;android-[0-9]+;google_apis;$abi "',
        'a google_apis system image',
      ),
      'echo "Installing emulator $img"',
      'yes | "$sdkm" "emulator" "$img"',
    ].join('\n'),
  },
  ndk: {
    label: 'install Android NDK',
    script: [
      SDK_ENV,
      newest('ndk', "'ndk;[0-9]+\\.[0-9]+\\.[0-9]+ '", 'an NDK'),
      'echo "Installing $ndk"',
      'yes | "$sdkm" "$ndk"',
    ].join('\n'),
  },
  cmake: {
    label: 'install Android CMake',
    script: [
      SDK_ENV,
      newest('cm', "'cmake;[0-9]+\\.[0-9]+\\.[0-9]+ '", 'CMake'),
      'echo "Installing $cm"',
      'yes | "$sdkm" "$cm"',
    ].join('\n'),
  },
};

/**
 * Option keys:
 * - platforms   select latest | latest-and-previous   (default latest; `platforms;android-N`)
 * - build-tools select latest                         (default latest)
 * - addons      multi  emulator | ndk | cmake         (default []; all via sdkmanager)
 *   emulator = emulator + the newest google_apis system image for this CPU.
 * Licenses need explicit consent and are never accepted silently: install() throws
 * unless `ic.yes` is set. The CLI asks the user interactively and passes yes=true
 * only after they accepted (or when -y/--yes was given).
 */
export const android: Toolchain = {
  id: 'android',
  label: 'Android SDK',
  description:
    'JDK + cmdline-tools/platform-tools/build-tools -> /opt/android-sdk',
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
  async install(ic, choices) {
    requireApt(ic, 'android');
    const platforms = choiceString(choices, 'platforms');
    choiceString(choices, 'build-tools'); // only `latest` exists; validated for shape
    const addons = choiceList(choices, 'addons');
    if (!ic.yes) throw new Error(LICENSE_ERROR);
    ic.logger.log(
      'Android SDK licenses accepted (https://developer.android.com/studio/terms)',
    );

    ic.logger.log('Installing JDK');
    await ic.runner.asRoot(
      [
        aptInstall([
          'openjdk-17-jdk-headless',
          'unzip',
          'curl',
          'ca-certificates',
        ]),
        'if ! command -v java >/dev/null 2>&1; then',
        aptInstall(['default-jdk-headless']),
        'fi',
      ].join('\n'),
      'install JDK for the Android SDK',
    );

    const zip = await latestCmdlineTools(ic);
    ic.logger.log(`Downloading ${zip}`);
    await ic.runner.asRoot(
      cmdlineToolsScript(zip, ic.ctx.user),
      `install Android cmdline-tools (${zip})`,
    );
    await ic.runner.asUser(
      sdkPackagesScript(platforms === 'latest-and-previous'),
      'install Android SDK packages',
    );
    await ic.runner.asRoot(
      writeProfile(
        'android',
        [
          `export ANDROID_HOME=${ANDROID_SDK_DIR}`,
          `export ANDROID_SDK_ROOT=${ANDROID_SDK_DIR}`,
          'case ":$PATH:" in *:$ANDROID_HOME/platform-tools:*) ;; *) export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools" ;; esac',
        ].join('\n'),
      ),
      'write Android SDK profile',
    );
    await ic.runner.asUser(
      LINK_ANDROID_SDK,
      'link Flutter to the Android SDK if present',
    );

    for (const addon of addons) {
      const step = ADDON_SCRIPTS[addon];
      if (!step) throw new Error(`android: unknown add-on ${addon}`);
      await tryAddon(ic, `android add-on ${addon}`, () =>
        ic.runner.asUser(step.script, step.label),
      );
    }
  },
};
