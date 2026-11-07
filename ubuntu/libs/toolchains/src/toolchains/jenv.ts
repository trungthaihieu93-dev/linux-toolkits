import type { Toolchain } from '../types';

/**
 * Option keys:
 * - global select 17 | 21 | 25            (default 21; if not registered, warn and keep jenv's current global)
 * - addons multi  export | maven | gradle (default [export]; `jenv enable-plugin <name>`)
 */
export const jenv: Toolchain = {
  id: 'jenv',
  label: 'jenv',
  description: 'jenv Java version manager, registers the installed JDKs',
  requires: ['java'],
  options: [
    {
      key: 'global',
      kind: 'select',
      label: 'Global Java version',
      choices: [
        { value: '17', label: '17' },
        { value: '21', label: '21' },
        { value: '25', label: '25' },
      ],
      default: '21',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Plugins',
      choices: [
        { value: 'export', label: 'export plugin', hint: 'sets JAVA_HOME' },
        { value: 'maven', label: 'maven plugin' },
        { value: 'gradle', label: 'gradle plugin' },
      ],
      default: ['export'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
