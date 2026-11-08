import { summarizeOutside } from './outside';

describe('summarizeOutside', () => {
  it('lists aliases, exports, PATH, theme, plugins and source lines with line numbers', () => {
    const text = [
      '# comment alias x=y',
      "alias ll='ls -l'",
      'alias -g G="| grep"',
      'export EDITOR=vim',
      'export -U FOO',
      'PATH="$HOME/bin:$PATH"',
      'export PATH=/x:$PATH',
      'ZSH_THEME="robbyrussell"',
      'plugins=(git docker)',
      'source ~/.aliases',
      '. /etc/profile',
      'echo unrelated',
      '',
    ].join('\n');
    expect(summarizeOutside(text)).toEqual([
      { line: 2, kind: 'alias', name: 'll', text: "alias ll='ls -l'" },
      { line: 3, kind: 'alias', name: 'G', text: 'alias -g G="| grep"' },
      { line: 4, kind: 'export', name: 'EDITOR', text: 'export EDITOR=vim' },
      { line: 5, kind: 'export', name: 'FOO', text: 'export -U FOO' },
      { line: 6, kind: 'path', name: 'PATH', text: 'PATH="$HOME/bin:$PATH"' },
      { line: 7, kind: 'path', name: 'PATH', text: 'export PATH=/x:$PATH' },
      {
        line: 8,
        kind: 'zsh-theme',
        name: 'ZSH_THEME',
        text: 'ZSH_THEME="robbyrussell"',
      },
      {
        line: 9,
        kind: 'plugins',
        name: 'plugins',
        text: 'plugins=(git docker)',
      },
      {
        line: 10,
        kind: 'source',
        name: '~/.aliases',
        text: 'source ~/.aliases',
      },
      {
        line: 11,
        kind: 'source',
        name: '/etc/profile',
        text: '. /etc/profile',
      },
    ]);
  });

  it('skips lines inside the managed blocks', () => {
    const text = [
      "alias a='1'",
      '# >>> term-dashboard >>>',
      "alias b='2'",
      '# <<< term-dashboard <<<',
      '# >>> term-dashboard-omz >>>',
      "ZSH_THEME='x'",
      '# <<< term-dashboard-omz <<<',
      'source $ZSH/oh-my-zsh.sh',
    ].join('\n');
    expect(summarizeOutside(text).map((o) => o.line)).toEqual([1, 8]);
  });

  it('still summarises every line when markers are broken', () => {
    const text = "# >>> term-dashboard >>>\nalias b='2'\n";
    expect(summarizeOutside(text).map((o) => o.name)).toEqual(['b']);
  });
});
