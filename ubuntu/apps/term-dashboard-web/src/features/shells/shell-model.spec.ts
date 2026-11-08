import { groupBackups } from '../backups/backups-page';
import { parsePluginsLine, parseThemeLine } from './shell-config-form';
import { normalizeModel } from './shell-page';

const base = {
  aliases: [],
  exports: [],
  path: { prepend: [], append: [] },
  history: {},
};

describe('shell Config-mode helpers', () => {
  it('drops an oh-my-zsh part that sets nothing', () => {
    expect(normalizeModel({ ...base, ohMyZsh: { theme: undefined } })).toEqual(
      base,
    );
    expect(
      normalizeModel({ ...base, ohMyZsh: { theme: 'af-magic', extra: [] } }),
    ).toEqual({
      ...base,
      ohMyZsh: { theme: 'af-magic' },
    });
  });

  it('reads theme and plugins set outside the blocks', () => {
    expect(parseThemeLine('ZSH_THEME="robbyrussell"')).toBe('robbyrussell');
    expect(parseThemeLine("ZSH_THEME='agnoster'")).toBe('agnoster');
    expect(parsePluginsLine('plugins=(git docker)')).toEqual(['git', 'docker']);
    expect(parsePluginsLine('echo hi')).toBeNull();
  });
});

describe('groupBackups', () => {
  it('groups by file, newest first', () => {
    const ref = (fileId: 'bashrc' | 'zshrc', ts: string) => ({
      fileId,
      ts,
      path: `/${ts}`,
      size: 1,
    });
    expect(
      groupBackups([
        ref('zshrc', '20261108T010000Z'),
        ref('bashrc', '20261108T010000Z'),
        ref('bashrc', '20261108T020000Z'),
      ]).map(([id, list]) => [id, list.map((b) => b.ts)]),
    ).toEqual([
      ['bashrc', ['20261108T020000Z', '20261108T010000Z']],
      ['zshrc', ['20261108T010000Z']],
    ]);
  });
});
