import { aptInstall, shQuote, writeProfile } from '@linux-toolchain/core';
import { choiceList, choiceString } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { errorMessage, requireApt, tryAddon } from './shared';

/** Used when services.gradle.org cannot be reached or answers with something unusable. */
export const GRADLE_FALLBACK_VERSION = '9.2.0';
const GRADLE_VERSION_URL = 'https://services.gradle.org/versions/current';
const GRADLE_VERSION_RE = /^\d+(\.\d+){1,2}$/;
const GRADLE_HOME = '/opt/gradle';

/**
 * Latest stable Gradle release from services.gradle.org (JSON `{ version, ... }`).
 * Never throws: on any failure it warns and returns GRADLE_FALLBACK_VERSION.
 * The download URLs are built from the validated version, never taken from the response.
 */
export async function latestGradleVersion(ic: InstallContext): Promise<string> {
  let reason: string;
  try {
    const res = await ic.fetch(GRADLE_VERSION_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'linux-toolchain' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      const version =
        body && typeof body === 'object' && 'version' in body
          ? (body as { version: unknown }).version
          : undefined;
      if (typeof version === 'string' && GRADLE_VERSION_RE.test(version))
        return version;
      reason = 'response has no usable version';
    } else {
      reason = `HTTP ${res.status}`;
    }
  } catch (error) {
    reason = errorMessage(error);
  }
  ic.warn(
    `could not resolve the latest Gradle release (${reason}); using ${GRADLE_FALLBACK_VERSION}`,
  );
  return GRADLE_FALLBACK_VERSION;
}

/** Root script: download the Gradle distribution, verify its sha256, unpack to /opt/gradle/gradle-<v>, link `current`. */
export function gradleInstallScript(version: string): string {
  if (!GRADLE_VERSION_RE.test(version))
    throw new Error(`invalid Gradle version: ${JSON.stringify(version)}`);
  const zipUrl = `https://services.gradle.org/distributions/gradle-${version}-bin.zip`;
  const dir = `${GRADLE_HOME}/gradle-${version}`;
  const pathLine = `case ":$PATH:" in *:${GRADLE_HOME}/current/bin:*) ;; *) export PATH="$PATH:${GRADLE_HOME}/current/bin" ;; esac`;
  return [
    aptInstall(['curl', 'unzip', 'ca-certificates']),
    '(',
    'set -e',
    'tmp=$(mktemp -d)',
    `trap 'rm -rf "$tmp"' EXIT`,
    `curl -fsSL --retry 3 -o "$tmp/gradle.zip" ${shQuote(zipUrl)}`,
    `expected=$(curl -fsSL --retry 3 ${shQuote(`${zipUrl}.sha256`)} | awk 'NR==1 {print $1}')`,
    `[ -n "$expected" ] || { echo ${shQuote(`no sha256 published for ${zipUrl}`)} >&2; exit 1; }`,
    `printf '%s  %s\\n' "$expected" "$tmp/gradle.zip" | sha256sum -c --quiet -`,
    `install -d ${shQuote(GRADLE_HOME)}`,
    `rm -rf ${shQuote(dir)}`,
    `unzip -q "$tmp/gradle.zip" -d ${shQuote(GRADLE_HOME)}`,
    `[ -x ${shQuote(`${dir}/bin/gradle`)} ] || { echo ${shQuote(`unexpected archive layout: ${dir}/bin/gradle missing`)} >&2; exit 1; }`,
    `ln -sfn ${shQuote(dir)} ${shQuote(`${GRADLE_HOME}/current`)}`,
    ')',
    writeProfile('gradle', pathLine),
    `${GRADLE_HOME}/current/bin/gradle --version`,
  ].join('\n');
}

/** Root script: apt-install the JDKs, warn per missing JDK, fail only if none got installed (as the bash script). */
function jdkInstallScript(versions: readonly string[]): string {
  const list = versions.map(shQuote).join(' ');
  return [
    aptInstall(versions.map((v) => `openjdk-${v}-jdk`)),
    'found=0',
    `for v in ${list}; do`,
    '  if compgen -G "/usr/lib/jvm/java-$v-openjdk-*" >/dev/null; then',
    '    found=1',
    '  else',
    `    printf '\\033[1;33m[warn]\\033[0m %s\\n' "JDK $v not installed (not available from this release's apt repos?)" >&2`,
    '  fi',
    'done',
    `[ "$found" = 1 ] || { echo 'no JDK could be installed' >&2; exit 1; }`,
    'ls -d /usr/lib/jvm/java-*-openjdk-* 2>/dev/null || true',
  ].join('\n');
}

/** Root script: make JDK `v` the system default java/javac through update-alternatives. */
function defaultJdkScript(v: string): string {
  return [
    `d=$(compgen -G ${shQuote(`/usr/lib/jvm/java-${v}-openjdk-*`)} | head -n1 || true)`,
    `[ -n "$d" ] && [ -x "$d/bin/java" ] || { echo ${shQuote(`JDK ${v} is not installed; default left unchanged`)} >&2; exit 1; }`,
    'update-alternatives --set java "$d/bin/java"',
    'if [ -x "$d/bin/javac" ]; then update-alternatives --set javac "$d/bin/javac"; fi',
    'java -version',
  ].join('\n');
}

/**
 * Option keys:
 * - jdk     multi  17 | 21 | 25            (default [21], min 1; apt openjdk-N-jdk)
 * - default select 17 | 21 | 25            (default 21; not among `jdk` -> warn and use the highest selected)
 * - addons  multi  maven | gradle | jenv   (default [maven, gradle])
 *   maven via apt; gradle = latest zip -> /opt/gradle + profile.d;
 *   jenv selects the `jenv` component (see addonImplies) — not installed here.
 */
export const java: Toolchain = {
  id: 'java',
  label: 'JDK (OpenJDK)',
  description: 'OpenJDK 17/21/25 (apt) -> /usr/lib/jvm, Maven, Gradle',
  isPresent: (p) =>
    p.listDir('/usr/lib/jvm').some((name) => /^java-.+-openjdk-/.test(name)),
  addonImplies: { jenv: 'jenv' },
  options: [
    {
      key: 'jdk',
      kind: 'multi',
      label: 'JDK versions',
      choices: [
        { value: '17', label: 'OpenJDK 17', hint: 'LTS' },
        { value: '21', label: 'OpenJDK 21', hint: 'LTS' },
        { value: '25', label: 'OpenJDK 25', hint: 'LTS' },
      ],
      default: ['21'],
      min: 1,
    },
    {
      key: 'default',
      kind: 'select',
      label: 'Default JDK',
      choices: [
        { value: '17', label: 'OpenJDK 17' },
        { value: '21', label: 'OpenJDK 21' },
        { value: '25', label: 'OpenJDK 25' },
      ],
      default: '21',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'maven', label: 'Maven', hint: 'apt' },
        { value: 'gradle', label: 'Gradle', hint: 'latest zip -> /opt/gradle' },
        { value: 'jenv', label: 'jenv', hint: 'selects the jenv component' },
      ],
      default: ['maven', 'gradle'],
    },
  ],
  async install(ic, choices) {
    requireApt(ic, 'java');
    const jdks = [...choiceList(choices, 'jdk')].sort(
      (a, b) => Number(a) - Number(b),
    );
    if (jdks.length === 0) throw new Error('java: select at least one JDK');
    let def = choiceString(choices, 'default');
    const highest = jdks[jdks.length - 1] as string;
    if (!jdks.includes(def)) {
      ic.warn(
        `default JDK ${def} is not among the selected JDKs (${jdks.join(', ')}); using ${highest}`,
      );
      def = highest;
    }
    const addons = choiceList(choices, 'addons');

    ic.logger.log(`Installing OpenJDK ${jdks.join(', ')}`);
    await ic.runner.asRoot(
      jdkInstallScript(jdks),
      `install OpenJDK ${jdks.join(', ')}`,
    );
    await tryAddon(ic, `setting the default JDK to ${def}`, () =>
      ic.runner.asRoot(defaultJdkScript(def), `set default JDK ${def}`),
    );

    if (addons.includes('maven')) {
      await tryAddon(ic, 'java add-on maven', () =>
        ic.runner.asRoot(
          `${aptInstall(['maven'])}\nmvn -version`,
          'install Maven',
        ),
      );
    }
    if (addons.includes('gradle')) {
      await tryAddon(ic, 'java add-on gradle', async () => {
        const version = await latestGradleVersion(ic);
        await ic.runner.asRoot(
          gradleInstallScript(version),
          `install Gradle ${version}`,
        );
      });
    }
  },
};
