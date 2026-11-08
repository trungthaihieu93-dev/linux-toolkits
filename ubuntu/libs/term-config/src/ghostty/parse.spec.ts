import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  entries,
  findConflicts,
  getValues,
  GhosttyConfigError,
  includes,
  parseGhostty,
  unquote,
  valuesByKey,
} from './parse';
import { serializeGhostty, setList, setValue, unset } from './serialize';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');
const config = fixture('ghostty-config.ghostty');

describe('Ghostty round-trip', () => {
  it.each([
    ['ghostty-config.ghostty', config],
    ['ghostty-show-config-docs.txt', fixture('ghostty-show-config-docs.txt')],
    ['empty', ''],
    ['no final newline', 'a = 1\n# c'],
    ['CRLF', 'a = 1\r\n\r\nb = 2\r\n'],
  ])('serialize(parse(x)) === x for %s', (_name, text) => {
    expect(serializeGhostty(parseGhostty(text))).toBe(text);
  });

  it('keeps every line and its kind', () => {
    const doc = parseGhostty(config);
    expect(doc.lines.map((l) => l.raw).join('\n') + '\n').toBe(config);
    expect(doc.lines.filter((l) => l.kind === 'comment')).toHaveLength(3);
    expect(getValues(doc, 'font-family')).toEqual([
      '"JetBrains Mono"',
      'Noto Color Emoji',
    ]);
    expect(getValues(doc, 'keybind')).toHaveLength(2);
  });

  it('marks lines without a valid key as invalid but keeps them', () => {
    const doc = parseGhostty('= x\nBad Key = 1\nflag\n');
    expect(doc.lines.map((l) => l.kind)).toEqual([
      'invalid',
      'invalid',
      'entry',
    ]);
    expect(entries(doc)[0]).toMatchObject({ key: 'flag', value: '' });
  });
});

describe('Ghostty edits', () => {
  it('setValue rewrites the winning line in place and keeps the rest', () => {
    const doc = parseGhostty(config);
    setValue(doc, 'font-size', '14');
    const out = serializeGhostty(doc);
    expect(out).toBe(config.replace('font-size = 13', 'font-size = 14'));
  });

  it('setValue edits the last occurrence of a duplicated key', () => {
    const doc = parseGhostty('theme = a\ntheme = b\n');
    setValue(doc, 'theme', 'c');
    expect(serializeGhostty(doc)).toBe('theme = a\ntheme = c\n');
  });

  it('setValue with the same value leaves the doc untouched', () => {
    const doc = parseGhostty(config);
    setValue(doc, 'font-size', '13');
    expect(doc.dirty).toBe(false);
  });

  it('setValue appends a new key after the last non-blank line', () => {
    const doc = parseGhostty('a = 1\n\n');
    setValue(doc, 'b', '2');
    expect(serializeGhostty(doc)).toBe('a = 1\nb = 2\n\n');
    const empty = parseGhostty('');
    setValue(empty, 'b', '');
    expect(serializeGhostty(empty)).toBe('b =\n');
  });

  it('setList replaces a repeated key at its first position', () => {
    const doc = parseGhostty(config);
    setList(doc, 'font-family', ['Iosevka', '"Noto Sans Mono"', 'Symbols']);
    const out = serializeGhostty(doc);
    expect(out).toContain(
      'theme = Catppuccin Mocha\nfont-family = Iosevka\nfont-family = "Noto Sans Mono"\nfont-family = Symbols\nfont-size = 13\n',
    );
    expect(getValues(parseGhostty(out), 'font-family')).toHaveLength(3);
  });

  it('setList collects scattered occurrences and supports Ghostty clear', () => {
    const doc = parseGhostty('keybind = a=b\nx = 1\nkeybind = c=d\n');
    setList(doc, 'keybind', ['clear', 'e=f']);
    expect(serializeGhostty(doc)).toBe(
      'keybind = clear\nkeybind = e=f\nx = 1\n',
    );
  });

  it('setList appends a new key and an empty list removes it', () => {
    const doc = parseGhostty('x = 1\n');
    setList(doc, 'palette', ['0=#000000', '1=#ffffff']);
    expect(serializeGhostty(doc)).toBe(
      'x = 1\npalette = 0=#000000\npalette = 1=#ffffff\n',
    );
    setList(doc, 'palette', []);
    expect(serializeGhostty(doc)).toBe('x = 1\n');
  });

  it('unset removes every occurrence and is a no-op for missing keys', () => {
    const doc = parseGhostty(config);
    unset(doc, 'missing-key');
    expect(doc.dirty).toBe(false);
    unset(doc, 'keybind');
    const out = serializeGhostty(doc);
    expect(out).not.toContain('keybind');
    expect(out.split('\n').length).toBe(config.split('\n').length - 2);
  });

  it('rejects invalid keys and multi-line values', () => {
    const doc = parseGhostty('');
    expect(() => setValue(doc, 'Bad', '1')).toThrow(GhosttyConfigError);
    expect(() => setValue(doc, 'a', '1\nb = 2')).toThrow(GhosttyConfigError);
    expect(() => setList(doc, 'a', ['x\r'])).toThrow(GhosttyConfigError);
    expect(() => unset(doc, '')).toThrow(GhosttyConfigError);
  });

  it('writes CRLF files with CRLF', () => {
    const doc = parseGhostty('a = 1\r\n');
    setValue(doc, 'b', '2');
    expect(serializeGhostty(doc)).toBe('a = 1\r\nb = 2\r\n');
  });
});

describe('Ghostty helpers', () => {
  it('lists config-file includes with optional markers and line numbers', () => {
    expect(includes(parseGhostty(config))).toEqual([
      { path: 'themes/local.conf', optional: true, line: 17 },
      { path: 'extra.conf', optional: false, line: 18 },
    ]);
    expect(includes(parseGhostty('config-file = "?/a b"\n'))).toEqual([
      { path: '/a b', optional: true, line: 1 },
    ]);
  });

  it('unquotes one pair of double quotes', () => {
    expect(unquote('"a"')).toBe('a');
    expect(unquote('"')).toBe('"');
    expect(unquote('a')).toBe('a');
  });

  it('groups values by key', () => {
    expect(valuesByKey(parseGhostty('a = 1\nb = 2\na = 3\n'))).toEqual({
      a: ['1', '3'],
      b: ['2'],
    });
  });

  it('reports keys set in both files with the later file as winner', () => {
    const conflicts = findConflicts(
      [
        {
          id: 'ghostty',
          doc: parseGhostty('theme = a\nkeybind = x=y\nfont-size = 1\n'),
        },
        {
          id: 'ghostty-legacy',
          doc: parseGhostty('theme = b\nkeybind = z=w\n'),
        },
      ],
      (k) => k === 'keybind',
    );
    expect(conflicts).toEqual([
      {
        key: 'theme',
        files: ['ghostty', 'ghostty-legacy'],
        winner: 'ghostty-legacy',
      },
    ]);
  });
});
