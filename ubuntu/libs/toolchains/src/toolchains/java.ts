import type { Toolchain } from '../types';

/**
 * Option keys:
 * - jdk     multi  17 | 21 | 25            (default [21], min 1; apt openjdk-N-jdk)
 * - default select 17 | 21 | 25            (default 21; must be one of `jdk`, validate in install)
 * - addons  multi  maven | gradle | jenv   (default [maven, gradle])
 *   maven via apt; gradle = latest zip -> /opt/gradle + profile.d;
 *   jenv selects the `jenv` component (see addonImplies) — do not install it here.
 */
export const java: Toolchain = {
  id: 'java',
  label: 'JDK 21 + 25',
  description: 'OpenJDK 21 and 25 (apt) -> /usr/lib/jvm',
  isPresent: (p) => p.listDir('/usr/lib/jvm').some((name) => /^java-.+-openjdk-/.test(name)),
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
  async install() {
    throw new Error('not implemented');
  },
};
