import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ShellBlockModel, ShellName } from '../api';
import { findBlock, OMZ_BLOCK } from './managed-block';
import {
  analyzeShellFile,
  applyShellModel,
  BLOCK_HEADER,
  emptyShellModel,
  parseBlock,
  parseOmzBlock,
  readShellModel,
  renderBlock,
  renderOmzBlock,
  ShellModelError,
  splitStatements,
  unquoteShWord,
  validateShellModel,
} from './model';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');
const zshrc = fixture('zshrc-ohmyzsh.txt');
const bashrc = fixture('bashrc-ubuntu.txt');

const hasZsh = spawnSync('zsh', ['-c', 'exit 0']).status === 0;

const full: ShellBlockModel = {
  aliases: [
    { name: 'll', command: 'ls -alF' },
    { name: 'gs', command: "git status --short && echo 'done'" },
  ],
  exports: [
    { name: 'EDITOR', value: 'nvim' },
    { name: 'EMPTY', value: '' },
  ],
  path: { prepend: ['~/.local/bin', '/opt/tools/bin'], append: ['~'] },
  history: { size: 5000, fileSize: 10000, ignoreDups: true, share: false },
};

const HOSTILE = [
  "it's",
  'say "hi"',
  '$(touch "$HOME/pwned")',
  '`touch "$HOME/pwned2"`',
  'line one\nline two',
  'mix \'"$HOME"\' \\ end',
  '; touch "$HOME/pwned3" #',
];

function hostileModel(): ShellBlockModel {
  return {
    ...emptyShellModel(),
    aliases: HOSTILE.map((command, i) => ({ name: `h${i}`, command })),
    exports: HOSTILE.map((value, i) => ({ name: `H${i}`, value })),
  };
}

function check(
  shell: ShellName,
  text: string,
): { status: number | null; stderr: string } {
  const r = spawnSync(shell, ['-n'], { input: text, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

describe('renderBlock and parseBlock', () => {
  it.each<ShellName>(['bash', 'zsh'])(
    'round-trips a full model for %s',
    (shell) => {
      const body = renderBlock(full, shell);
      expect(parseBlock(body)).toEqual(full);
      expect(renderBlock(parseBlock(body), shell)).toBe(body);
    },
  );

  it('renders bash-specific history settings', () => {
    expect(renderBlock(full, 'bash')).toBe(
      [
        BLOCK_HEADER,
        "alias ll='ls -alF'",
        `alias gs='git status --short && echo '\\''done'\\'''`,
        "export EDITOR='nvim'",
        "export EMPTY=''",
        `export PATH="$HOME"'/.local/bin':'/opt/tools/bin':"$PATH":"$HOME"`,
        'HISTSIZE=5000',
        'HISTFILESIZE=10000',
        'HISTCONTROL=ignoredups',
        'shopt -u histappend',
      ].join('\n'),
    );
  });

  it('renders zsh-specific history settings', () => {
    const body = renderBlock(
      {
        ...emptyShellModel(),
        history: { size: 1, fileSize: 2, ignoreDups: false, share: true },
      },
      'zsh',
    );
    expect(body.split('\n').slice(1)).toEqual([
      'HISTSIZE=1',
      'SAVEHIST=2',
      'unsetopt HIST_IGNORE_DUPS',
      'setopt SHARE_HISTORY',
    ]);
  });

  it('round-trips hostile values, including multi-line ones', () => {
    const model = hostileModel();
    const body = renderBlock(model, 'bash');
    expect(parseBlock(body)).toEqual(model);
  });

  it('keeps unknown lines verbatim in extra and renders them back', () => {
    const body = [
      BLOCK_HEADER,
      "alias a='b'",
      'eval "$(starship init bash)"',
      "alias a='duplicate'",
      'export BAD=$(id)',
      `export PATH="$PATH:/x"`,
      'HISTSIZE=10',
      'HISTSIZE=20',
    ].join('\n');
    const model = parseBlock(body);
    expect(model.aliases).toEqual([{ name: 'a', command: 'b' }]);
    expect(model.history).toEqual({ size: 10 });
    expect(model.extra).toEqual([
      'eval "$(starship init bash)"',
      "alias a='duplicate'",
      'export BAD=$(id)',
      'export PATH="$PATH:/x"',
      'HISTSIZE=20',
    ]);
    const again = renderBlock(model, 'bash');
    expect(parseBlock(again)).toEqual(model);
  });

  it('does not join an unknown line with an unbalanced quote', () => {
    expect(splitStatements("echo it's\nalias a='b'")).toEqual([
      "echo it's",
      "alias a='b'",
    ]);
    expect(splitStatements("alias a='open\nnever closed")).toEqual([
      "alias a='open",
      'never closed',
    ]);
  });

  it('unquotes only shQuote output', () => {
    expect(unquoteShWord("'it'\\''s'")).toBe("it's");
    expect(unquoteShWord("''")).toBe('');
    expect(unquoteShWord('bare')).toBeNull();
    expect(unquoteShWord("'open")).toBeNull();
    expect(unquoteShWord('')).toBeNull();
  });
});

describe('validateShellModel', () => {
  it.each<[string, ShellBlockModel, RegExp]>([
    [
      'bad alias name',
      { ...emptyShellModel(), aliases: [{ name: 'a b', command: 'x' }] },
      /alias name/,
    ],
    [
      'duplicate alias',
      {
        ...emptyShellModel(),
        aliases: [
          { name: 'a', command: 'x' },
          { name: 'a', command: 'y' },
        ],
      },
      /twice/,
    ],
    [
      'empty command',
      { ...emptyShellModel(), aliases: [{ name: 'a', command: '' }] },
      /empty/,
    ],
    [
      'bad var',
      { ...emptyShellModel(), exports: [{ name: '1X', value: '' }] },
      /variable name/,
    ],
    [
      'PATH export',
      { ...emptyShellModel(), exports: [{ name: 'PATH', value: '/x' }] },
      /PATH section/,
    ],
    [
      'marker in value',
      {
        ...emptyShellModel(),
        exports: [{ name: 'X', value: 'a\n# <<< term-dashboard <<<\nb' }],
      },
      /block marker/,
    ],
    [
      'NUL',
      { ...emptyShellModel(), exports: [{ name: 'X', value: 'a\0' }] },
      /NUL/,
    ],
    [
      'colon in PATH',
      { ...emptyShellModel(), path: { prepend: ['/a:/b'], append: [] } },
      /PATH entry/,
    ],
    [
      'negative history',
      { ...emptyShellModel(), history: { size: -1 } },
      /whole number/,
    ],
    [
      'omz on bash',
      { ...emptyShellModel(), ohMyZsh: { theme: 'x' } },
      /zsh only/,
    ],
  ])('rejects %s', (_name, model, message) => {
    const shell: ShellName = _name === 'omz on bash' ? 'bash' : 'zsh';
    const problems = validateShellModel(model, shell);
    expect(problems.join('\n')).toMatch(message);
    expect(() => renderBlock(model, shell)).toThrow(ShellModelError);
  });

  it('rejects bad plugin names', () => {
    expect(
      validateShellModel(
        { ...emptyShellModel(), ohMyZsh: { plugins: ['ok', 'no way'] } },
        'zsh',
      ),
    ).toEqual(['invalid oh-my-zsh plugin name "no way"']);
  });
});

describe('oh-my-zsh block body', () => {
  it('round-trips theme, plugins and extra lines', () => {
    const omz = {
      theme: "my 'theme'",
      plugins: ['git', 'zsh-autosuggestions'],
      extra: ['ZSH_X=1'],
    };
    const body = renderOmzBlock(omz);
    expect(body).toBe(
      `ZSH_THEME='my '\\''theme'\\'''\nplugins=('git' 'zsh-autosuggestions')\nZSH_X=1`,
    );
    expect(parseOmzBlock(body ?? '')).toEqual(omz);
    expect(parseOmzBlock("plugins=()\nZSH_THEME=''")).toEqual({
      plugins: [],
      theme: '',
    });
  });

  it('renders nothing when there is nothing to set', () => {
    expect(renderOmzBlock(undefined)).toBeNull();
    expect(renderOmzBlock({})).toBeNull();
  });
});

describe('applyShellModel on the fixtures', () => {
  it('writes the main block and reads the same model back (bash)', () => {
    const r = applyShellModel(bashrc, full, 'bash');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.startsWith(bashrc)).toBe(true);
    const back = readShellModel(r.value, 'bash');
    expect(back).toEqual({ ok: true, value: full });
    // Applying the same model again changes nothing.
    expect(applyShellModel(r.value, full, 'bash')).toEqual({
      ok: true,
      value: r.value,
    });
  });

  it('writes both blocks for zsh and removes them for an empty model', () => {
    const model = {
      ...full,
      ohMyZsh: { theme: 'agnoster', plugins: ['git', 'docker'] },
    };
    const r = applyShellModel(zshrc, model, 'zsh');
    if (!r.ok) throw new Error(r.error);
    expect(readShellModel(r.value, 'zsh')).toEqual({ ok: true, value: model });
    const omz = findBlock(r.value, OMZ_BLOCK);
    expect(omz.ok && omz.value && r.value.split('\n')[omz.value.end + 1]).toBe(
      'source $ZSH/oh-my-zsh.sh',
    );
    expect(applyShellModel(r.value, emptyShellModel(), 'zsh')).toEqual({
      ok: true,
      value: zshrc,
    });
  });

  it('fails with the reason when the oh-my-zsh source line is missing', () => {
    const r = applyShellModel(
      'echo hi\n',
      { ...emptyShellModel(), ohMyZsh: { theme: 'x' } },
      'zsh',
    );
    expect(r.ok).toBe(false);
  });

  it('fails on malformed markers instead of guessing', () => {
    const broken = `${bashrc}# >>> term-dashboard >>>\n`;
    expect(applyShellModel(broken, full, 'bash').ok).toBe(false);
    expect(readShellModel(broken, 'bash').ok).toBe(false);
  });
});

describe('analyzeShellFile', () => {
  it('describes the template zshrc', () => {
    const a = analyzeShellFile(zshrc, 'zsh');
    expect(a.blocks).toEqual({
      main: {
        name: 'term-dashboard',
        present: false,
        startLine: null,
        endLine: null,
      },
      omz: {
        name: 'term-dashboard-omz',
        present: false,
        startLine: null,
        endLine: null,
      },
    });
    expect(a.model).toEqual(emptyShellModel());
    expect(a.ohMyZsh).toEqual({
      detected: true,
      sourceLine: 78,
      editable: true,
    });
    expect(a.outside.map((o) => [o.line, o.kind, o.name])).toEqual([
      [5, 'export', 'ZSH'],
      [11, 'zsh-theme', 'ZSH_THEME'],
      [76, 'plugins', 'plugins'],
      [78, 'source', '$ZSH/oh-my-zsh.sh'],
    ]);
  });

  it('reports block positions after a save and errors for broken markers', () => {
    const r = applyShellModel(
      zshrc,
      { ...full, ohMyZsh: { theme: 'x' } },
      'zsh',
    );
    if (!r.ok) throw new Error(r.error);
    const a = analyzeShellFile(r.value, 'zsh');
    expect(a.blocks.omz).toMatchObject({
      present: true,
      startLine: 78,
      endLine: 80,
    });
    expect(a.ohMyZsh?.sourceLine).toBe(81);
    expect(a.blocks.main.present).toBe(true);
    const broken = analyzeShellFile(
      `${r.value}# <<< term-dashboard-omz <<<\n`,
      'zsh',
    );
    expect(broken.model).toBeNull();
    expect(broken.modelError).toMatch(/duplicate "term-dashboard-omz"/);
  });

  it('has no oh-my-zsh state for bash', () => {
    const a = analyzeShellFile(bashrc, 'bash');
    expect(a.ohMyZsh).toBeNull();
    expect(a.blocks.omz).toBeNull();
    expect(
      a.outside.filter((o) => o.kind === 'alias').map((o) => o.name),
    ).toEqual(['ls', 'grep', 'fgrep', 'egrep', 'll', 'la', 'l', 'alert']);
  });
});

describe('syntax checks with the real shells', () => {
  it.each(['full', 'hostile'])(
    'bash -n accepts the %s block in the bashrc fixture',
    (kind) => {
      const model = kind === 'full' ? full : hostileModel();
      const r = applyShellModel(bashrc, model, 'bash');
      if (!r.ok) throw new Error(r.error);
      expect(check('bash', r.value)).toEqual({ status: 0, stderr: '' });
    },
  );

  it.skipIf(!hasZsh).each(['full', 'hostile'])(
    'zsh -n accepts the %s blocks in the oh-my-zsh template',
    (kind) => {
      const model = {
        ...(kind === 'full' ? full : hostileModel()),
        ohMyZsh: { theme: "it's", plugins: ['git'] },
      };
      const r = applyShellModel(zshrc, model, 'zsh');
      if (!r.ok) throw new Error(r.error);
      expect(check('zsh', r.value)).toEqual({ status: 0, stderr: '' });
    },
  );
});

describe('sourcing hostile values in a temp HOME', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'term-config-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const env = () => ({
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: home,
  });

  function expectExact(output: string): void {
    const values = output.split('\0').slice(0, -1);
    expect(values).toEqual([...HOSTILE, ...HOSTILE]);
    for (const f of ['pwned', 'pwned2', 'pwned3'])
      expect(existsSync(join(home, f))).toBe(false);
  }

  it('bash sets exactly the input values', () => {
    const rc = join(home, '.bashrc');
    writeFileSync(rc, `${renderBlock(hostileModel(), 'bash')}\n`);
    const names = HOSTILE.map((_, i) => i);
    const script = [
      'source "$HOME/.bashrc"',
      ...names.map((i) => `printf '%s\\0' "\${BASH_ALIASES[h${i}]}"`),
      ...names.map((i) => `printf '%s\\0' "$H${i}"`),
    ].join('\n');
    expectExact(
      execFileSync('bash', ['--norc', '-c', script], {
        env: env(),
        encoding: 'utf8',
      }),
    );
  });

  it.skipIf(!hasZsh)('zsh sets exactly the input values', () => {
    const rc = join(home, '.zshrc');
    writeFileSync(rc, `${renderBlock(hostileModel(), 'zsh')}\n`);
    const names = HOSTILE.map((_, i) => i);
    const script = [
      'source "$HOME/.zshrc"',
      ...names.map(
        (i) => `print -rn -- "\${aliases[h${i}]}"; print -rn -- $'\\0'`,
      ),
      ...names.map((i) => `print -rn -- "$H${i}"; print -rn -- $'\\0'`),
    ].join('\n');
    expectExact(
      execFileSync('zsh', ['-f', '-c', script], {
        env: env(),
        encoding: 'utf8',
      }),
    );
  });

  it('bash puts PATH entries in order with ~ expanded at runtime', () => {
    writeFileSync(join(home, 'rc'), `${renderBlock(full, 'bash')}\n`);
    const out = execFileSync(
      'bash',
      ['--norc', '-c', 'source "$HOME/rc"; printf %s "$PATH"'],
      {
        env: { ...env(), PATH: '/usr/bin:/bin' },
        encoding: 'utf8',
      },
    );
    expect(out).toBe(`${home}/.local/bin:/opt/tools/bin:/usr/bin:/bin:${home}`);
  });

  it.skipIf(!hasZsh)(
    'the omz block takes effect: oh-my-zsh sees the managed theme and plugins',
    () => {
      const zsh = join(home, '.oh-my-zsh');
      mkdirSync(zsh);
      // Stub oh-my-zsh.sh records what the real one would read.
      writeFileSync(
        join(zsh, 'oh-my-zsh.sh'),
        'print -rn -- "theme=$ZSH_THEME plugins=${(j:,:)plugins}"\n',
      );
      const model = {
        ...emptyShellModel(),
        ohMyZsh: { theme: 'agnoster', plugins: ['git', 'docker'] },
      };
      const r = applyShellModel(zshrc, model, 'zsh');
      if (!r.ok) throw new Error(r.error);
      writeFileSync(join(home, '.zshrc'), r.value);
      const out = execFileSync('zsh', ['-f', '-c', 'source "$HOME/.zshrc"'], {
        env: env(),
        encoding: 'utf8',
      });
      expect(out).toBe('theme=agnoster plugins=git,docker');
      // Without the block, the template's own values apply.
      writeFileSync(join(home, '.zshrc'), zshrc);
      const before = execFileSync(
        'zsh',
        ['-f', '-c', 'source "$HOME/.zshrc"'],
        {
          env: env(),
          encoding: 'utf8',
        },
      );
      expect(before).toBe('theme=robbyrussell plugins=git');
    },
  );
});
