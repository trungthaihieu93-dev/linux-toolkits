import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalGVariant,
  formatGVariant,
  GVariantError,
  isSupportedGVariantType,
  parseGVariant,
  type GVariantValue,
} from './gvariant';
import { parseGSchemaFiles } from './gschema';
import { parseGSettingsList } from './gsettings-list';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseGVariant', () => {
  it.each<[string, string, GVariantValue]>([
    ['true', 'b', true],
    ['false', 'b', false],
    ['10000', 'i', 10000],
    ['-5', 'i', -5],
    ['uint32 129', 'u', 129],
    ['0x10', 'u', 16],
    ['1.0', 'd', 1],
    ['0.25', 'd', 0.25],
    ['1e-3', 'd', 0.001],
    ['42', 'd', 42],
    ["'block'", 's', 'block'],
    ['"it\'s"', 's', "it's"],
    ["'a\\'b\\\\c\\n\\u00e9'", 's', "a'b\\c\né"],
    ['[]', 'as', []],
    ['@as []', 'as', []],
    ["['a', 'b']", 'as', ['a', 'b']],
    ['(uint32 129, uint32 40)', '(uu)', [129, 40]],
    ['(0,0)', '(uu)', [0, 0]],
    [
      "[('x', 'y'), ('$1', 'https://e/$2')]",
      'a(ss)',
      [
        ['x', 'y'],
        ['$1', 'https://e/$2'],
      ],
    ],
    ['nothing', 'ms', null],
    ['@ms nothing', 'ms', null],
    ["'x'", 'ms', 'x'],
    ["just 'x'", 'ms', 'x'],
    ['uint32 7', 'mu', 7],
    ['(true,)', '(b)', [true]],
  ])('parses %s as %s', (text, type, expected) => {
    expect(parseGVariant(text, type)).toEqual(expected);
  });

  it.each([
    ['yes', 'b'],
    ['4294967296', 'u'],
    ['-1', 'u'],
    ['1.5', 'i'],
    ["'unterminated", 's'],
    ["['a',]", 'as'],
    ["['a'] x", 'as'],
    ['(1)', '(u)'],
    ['@ai []', 'as'],
    ['uint32 5', 'i'],
    ['inf', 'd'],
  ])('rejects %s as %s', (text, type) => {
    expect(() => parseGVariant(text, type)).toThrow(GVariantError);
  });

  it.each(['ay', 'v', 'a{ss}', 'x', 'mms', '(uu', 'ss'])(
    'rejects the unsupported type %s',
    (type) => {
      expect(isSupportedGVariantType(type)).toBe(false);
      expect(() => parseGVariant('[]', type)).toThrow(GVariantError);
    },
  );
});

describe('formatGVariant', () => {
  it.each<[GVariantValue, string, string]>([
    [true, 'b', 'true'],
    [80, 'u', '80'],
    [1, 'd', '1.0'],
    [0.5, 'd', '0.5'],
    ["it's", 's', "'it\\'s'"],
    ['a\nb\tc\\', 's', "'a\\nb\\tc\\\\'"],
    ['\x01', 's', "'\\u0001'"],
    [[], 'as', '@as []'],
    [['a', 'b'], 'as', "['a', 'b']"],
    [[129, 40], '(uu)', '(129, 40)'],
    [[true], '(b)', '(true,)'],
    [null, 'ms', '@ms nothing'],
    ['x', 'ms', "'x'"],
  ])('formats %j as %s', (value, type, expected) => {
    expect(formatGVariant(value, type)).toBe(expected);
  });

  it.each<[GVariantValue, string]>([
    ['1', 'u'],
    [-1, 'u'],
    [1.5, 'i'],
    [Number.NaN, 'd'],
    ['a\0b', 's'],
    [[1], '(uu)'],
    ['x', 'as'],
  ])('rejects %j as %s', (value, type) => {
    expect(() => formatGVariant(value, type)).toThrow(GVariantError);
  });

  it('round-trips hostile strings', () => {
    const hostile = `'"$(rm -rf ~)\`id\`\n\\ end é ✓`;
    const text = formatGVariant([hostile, ''], 'as');
    expect(parseGVariant(text, 'as')).toEqual([hostile, '']);
  });

  it('canonicalises equal values that print differently', () => {
    expect(canonicalGVariant('uint32 80', 'u')).toBe(
      canonicalGVariant('80', 'u'),
    );
    expect(canonicalGVariant('(uint32 0, uint32 0)', '(uu)')).toBe('(0, 0)');
    expect(canonicalGVariant('nope', 'b')).toBeNull();
  });
});

describe('round-trip over captured gsettings values', () => {
  const schemas = parseGSchemaFiles([fixture('org.gnome.Ptyxis.gschema.xml')]);
  const types = new Map<string, string>();
  for (const s of schemas) {
    for (const k of s.keys) types.set(`${s.schemaId} ${k.name}`, k.type);
  }

  it('parses, formats and re-parses every value and default', () => {
    const lists = parseGSettingsList(fixture('ptyxis-list-recursively.txt'));
    const samples: [string, string][] = [];
    for (const [schema, keys] of Object.entries(lists)) {
      for (const [key, text] of Object.entries(keys)) {
        samples.push([types.get(`${schema} ${key}`) ?? '', text]);
      }
    }
    for (const s of schemas) {
      for (const k of s.keys) samples.push([k.type, k.default]);
    }
    expect(samples.length).toBeGreaterThan(100);
    for (const [type, text] of samples) {
      expect(type).not.toBe('');
      const value = parseGVariant(text, type);
      expect(parseGVariant(formatGVariant(value, type), type)).toEqual(value);
    }
  });
});
