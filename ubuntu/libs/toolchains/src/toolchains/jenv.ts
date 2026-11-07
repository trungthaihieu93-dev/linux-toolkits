import { addRcBlock, shQuote } from '@linux-toolchain/core';
import { choiceList, choiceString } from '../options';
import type { Toolchain } from '../types';
import { tryAddon } from './shared';

/** Puts jenv on PATH and initialises it in the current (user) shell. */
const JENV_INIT = [
  'export PATH="$HOME/.jenv/bin:$PATH"',
  'eval "$(jenv init -)"',
].join('\n');

/** Clone or update jenv, then register every OpenJDK in /usr/lib/jvm (real dirs only, not the java-1.x symlinks). */
const INSTALL_SCRIPT = [
  'if [ -d "$HOME/.jenv/.git" ]; then',
  '  git -C "$HOME/.jenv" pull --ff-only',
  'else',
  '  git clone https://github.com/jenv/jenv.git "$HOME/.jenv"',
  'fi',
  JENV_INIT,
  'for d in /usr/lib/jvm/java-*-openjdk-*; do',
  '  if [ -d "$d" ] && [ ! -L "$d" ]; then',
  '    jenv add "$d" || echo "could not register $d" >&2',
  '  fi',
  'done',
  'jenv versions',
].join('\n');

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
  async install(ic, choices) {
    const global = choiceString(choices, 'global');
    const plugins = choiceList(choices, 'addons');

    ic.logger.log('Installing jenv');
    await ic.runner.asUser(INSTALL_SCRIPT, 'install jenv and register JDKs');
    for (const plugin of plugins) {
      await tryAddon(ic, `jenv plugin ${plugin}`, () =>
        ic.runner.asUser(
          `${JENV_INIT}\njenv enable-plugin ${shQuote(plugin)}`,
          `enable jenv plugin ${plugin}`,
        ),
      );
    }
    // Switch later with `jenv global <v>` / `jenv local <v>`.
    await tryAddon(
      ic,
      `setting the jenv global version to ${global} (JDK ${global} not registered?)`,
      () =>
        ic.runner.asUser(
          `${JENV_INIT}\njenv global ${shQuote(global)}\njenv version`,
          `set jenv global ${global}`,
        ),
    );
    await ic.runner.asUser(
      addRcBlock('jenv', JENV_INIT),
      'add jenv to shell rc files',
    );
  },
};
