import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countDefaultLines, parseGhosttySchema, validValues } from './schema';

const dump = readFileSync(
  join(__dirname, '..', '__fixtures__', 'ghostty-show-config-docs.txt'),
  'utf8',
);
const schema = parseGhosttySchema(dump, '1.4.0');
const key = (name: string) => {
  const k = schema.keys.find((x) => x.key === name);
  if (!k) throw new Error(`missing ${name}`);
  return k;
};

describe('parseGhosttySchema on the captured docs dump', () => {
  it('reads all 629 key lines into 211 distinct keys', () => {
    expect(countDefaultLines(dump)).toBe(629);
    expect(schema.keys).toHaveLength(211);
    expect(schema.keys.reduce((n, k) => n + k.defaults.length, 0)).toBe(629);
    expect(schema.version).toBe('1.4.0');
  });

  it('maps theme and font keys to their pickers', () => {
    expect(key('theme').control).toBe('theme');
    expect(key('font-family')).toMatchObject({
      control: 'font',
      repeatable: true,
    });
    expect(key('font-family-bold')).toMatchObject({
      control: 'font',
      repeatable: true,
    });
    expect(key('window-title-font-family').control).toBe('font');
  });

  it('detects repeatable keys from repeated defaults and from the doc', () => {
    expect(key('keybind')).toMatchObject({ repeatable: true });
    expect(key('keybind').defaults.length).toBe(74);
    expect(key('palette').defaults.length).toBe(256);
    expect(key('palette').default).toBe('0=#1d1f21');
    expect(key('font-size').repeatable).toBe(false);
    expect(key('input').repeatable).toBe(true);
    // "Units can be repeated" in duration docs is not about the key.
    expect(key('resize-overlay-duration').repeatable).toBe(false);
  });

  it('keeps flag lists whose default is outside the bullets as text', () => {
    expect(key('bell-features').control).toBe('text');
  });

  it('detects booleans, numbers, colors and enums', () => {
    const bools = schema.keys.filter((k) => k.control === 'bool');
    expect(bools.length).toBeGreaterThan(30);
    expect(
      bools.every((k) => k.default === 'true' || k.default === 'false'),
    ).toBe(true);
    expect(key('mouse-hide-while-typing').control).toBe('bool');
    expect(key('font-size').control).toBe('number');
    expect(key('search-foreground').control).toBe('color');
    expect(key('cursor-style')).toMatchObject({
      control: 'enum',
      values: ['block', 'bar', 'underline', 'block_hollow'],
    });
    expect(key('background-image-position').values).toContain('bottom-right');
    expect(key('window-padding-balance')).toMatchObject({
      control: 'enum',
      values: ['false', 'true', 'equal'],
    });
    expect(key('cursor-style-blink')).toMatchObject({
      control: 'enum',
      values: ['', 'true', 'false'],
    });
  });

  it('keeps docs without the comment markers', () => {
    expect(key('language').doc).toMatch(
      /^Set Ghostty's graphical user interface/,
    );
    expect(key('language').doc).not.toMatch(/^#/m);
    expect(key('font-family-bold').doc).toBe(key('font-family').doc);
  });
});

describe('validValues', () => {
  it('reads bullets with backtick values and stops at the next paragraph', () => {
    const doc = [
      'Pick one. Valid values are:',
      '',
      '* `a` - first',
      '  continued',
      '* `b`',
      '',
      'Then `c` is not listed.',
    ].join('\n');
    expect(validValues(doc)).toEqual(['a', 'b']);
  });

  it('ignores lists whose bullets are not backtick values', () => {
    expect(
      validValues('Valid values:\n\n  - Hex (`#RRGGBB`)\n  - Named X11 color'),
    ).toBeUndefined();
    expect(
      validValues('Valid values are integers between `0` and `255`.'),
    ).toBe(undefined);
    expect(validValues('No list here.')).toBeUndefined();
  });
});
