import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findBlock,
  isOhMyZshSourceLine,
  MAIN_BLOCK,
  OMZ_BLOCK,
  ohMyZshDisabledReason,
  ohMyZshSourceLines,
  setMainBlock,
  setOmzBlock,
} from './managed-block';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');
const zshrc = fixture('zshrc-ohmyzsh.txt');
const bashrc = fixture('bashrc-ubuntu.txt');

const unwrap = <T>(
  r: { ok: true; value: T } | { ok: false; error: string },
): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('findBlock', () => {
  it('returns null for files without the block', () => {
    expect(unwrap(findBlock(bashrc, MAIN_BLOCK))).toBeNull();
    expect(unwrap(findBlock('', OMZ_BLOCK))).toBeNull();
  });

  it('locates the block and its body', () => {
    const text =
      'a\n# >>> term-dashboard >>>\nx\ny\n# <<< term-dashboard <<<\nb\n';
    expect(unwrap(findBlock(text, MAIN_BLOCK))).toEqual({
      name: MAIN_BLOCK,
      start: 1,
      end: 4,
      body: 'x\ny',
    });
    // The omz markers are different strings.
    expect(unwrap(findBlock(text, OMZ_BLOCK))).toBeNull();
  });

  it.each([
    ['unclosed', '# >>> term-dashboard >>>\nx\n', /unclosed/],
    ['end only', 'x\n# <<< term-dashboard <<<\n', /unclosed/],
    [
      'end before start',
      '# <<< term-dashboard <<<\n# >>> term-dashboard >>>\n',
      /unclosed/,
    ],
    [
      'duplicate',
      '# >>> term-dashboard >>>\n# <<< term-dashboard <<<\n# >>> term-dashboard >>>\n# <<< term-dashboard <<<\n',
      /duplicate.*lines 1, 2, 3, 4/,
    ],
  ])('reports %s markers as an error', (_name, text, message) => {
    const r = findBlock(text, MAIN_BLOCK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
    expect(setMainBlock(text, 'x').ok).toBe(false);
  });
});

describe('setMainBlock', () => {
  it('appends a new block after one blank line, keeping the file intact', () => {
    const out = unwrap(setMainBlock(bashrc, 'alias a=b'));
    expect(out.startsWith(bashrc)).toBe(true);
    expect(out.slice(bashrc.length)).toBe(
      '\n# >>> term-dashboard >>>\nalias a=b\n# <<< term-dashboard <<<\n',
    );
  });

  it('handles empty files and files without a final newline', () => {
    expect(unwrap(setMainBlock('', 'x'))).toBe(
      '# >>> term-dashboard >>>\nx\n# <<< term-dashboard <<<\n',
    );
    expect(unwrap(setMainBlock('a', 'x'))).toBe(
      'a\n\n# >>> term-dashboard >>>\nx\n# <<< term-dashboard <<<\n',
    );
  });

  it('replaces only the block body and round-trips removal', () => {
    const once = unwrap(setMainBlock(bashrc, 'one'));
    const twice = unwrap(setMainBlock(once, 'two\nlines'));
    expect(twice).toBe(once.replace('\none\n', '\ntwo\nlines\n'));
    expect(unwrap(setMainBlock(twice, null))).toBe(bashrc);
    expect(unwrap(setMainBlock(bashrc, null))).toBe(bashrc);
  });

  it('keeps an empty body as an empty block', () => {
    expect(unwrap(setMainBlock('', ''))).toBe(
      '# >>> term-dashboard >>>\n# <<< term-dashboard <<<\n',
    );
  });
});

describe('oh-my-zsh block', () => {
  it('recognises the source line spellings', () => {
    for (const line of [
      'source $ZSH/oh-my-zsh.sh',
      '  . "$ZSH/oh-my-zsh.sh"',
      'source ${ZSH}/oh-my-zsh.sh # load',
    ]) {
      expect(isOhMyZshSourceLine(line)).toBe(true);
    }
    expect(isOhMyZshSourceLine('# source $ZSH/oh-my-zsh.sh')).toBe(false);
    expect(isOhMyZshSourceLine('source ~/.aliases')).toBe(false);
  });

  it('finds the single source line in the template (line 78)', () => {
    expect(ohMyZshSourceLines(zshrc)).toEqual([77]);
    expect(ohMyZshDisabledReason(zshrc)).toBeNull();
  });

  it('inserts the block directly above the source line', () => {
    const out = unwrap(setOmzBlock(zshrc, "ZSH_THEME='agnoster'"));
    const lines = out.split('\n');
    const src = lines.indexOf('source $ZSH/oh-my-zsh.sh');
    expect(lines.slice(src - 3, src)).toEqual([
      '# >>> term-dashboard-omz >>>',
      "ZSH_THEME='agnoster'",
      '# <<< term-dashboard-omz <<<',
    ]);
    // Everything else is untouched.
    expect(unwrap(setOmzBlock(out, null))).toBe(zshrc);
  });

  it('replaces in place and moves a stray block back above the source line', () => {
    const once = unwrap(setOmzBlock(zshrc, 'a'));
    expect(unwrap(setOmzBlock(once, 'b'))).toBe(once.replace('\na\n', '\nb\n'));
    const stray = `${zshrc}# >>> term-dashboard-omz >>>\nold\n# <<< term-dashboard-omz <<<\n`;
    expect(unwrap(setOmzBlock(stray, 'a'))).toBe(once);
    const above = `# >>> term-dashboard-omz >>>\nold\n# <<< term-dashboard-omz <<<\n${zshrc}`;
    expect(unwrap(setOmzBlock(above, 'a'))).toBe(once);
  });

  it('ignores a source line inside the main block', () => {
    const text = `# >>> term-dashboard >>>\nsource $ZSH/oh-my-zsh.sh\n# <<< term-dashboard <<<\n${zshrc}`;
    expect(ohMyZshSourceLines(text)).toEqual([80]);
  });

  it('disables theme and plugins when the source line is missing or repeated', () => {
    const r1 = setOmzBlock('plugins=(git)\n', 'x');
    expect(r1.ok).toBe(false);
    if (!r1.ok)
      expect(r1.error).toMatch(/no "source \$ZSH\/oh-my-zsh.sh" line/);
    const twice = `${zshrc}source $ZSH/oh-my-zsh.sh\n`;
    const r2 = setOmzBlock(twice, 'x');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/appears 2 times/);
    // Removing is always allowed.
    expect(unwrap(setOmzBlock('x\n', null))).toBe('x\n');
  });

  it('refuses to touch an unclosed omz block', () => {
    expect(setOmzBlock(`# >>> term-dashboard-omz >>>\n${zshrc}`, 'x').ok).toBe(
      false,
    );
  });
});
