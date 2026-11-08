import type { GSettingsKeyView } from '@linux-toolchain/term-config';
import { gsettingsField, validatePaletteName } from './gsettings-fields';
import { latestBackupFor } from './terminal-settings-page';

const key = (over: Partial<GSettingsKeyView>): GSettingsKeyView => ({
  name: 'k',
  type: 's',
  summary: 'Summary',
  description: '',
  value: "''",
  default: "''",
  isDefault: true,
  ...over,
});

describe('gsettingsField', () => {
  it('maps GVariant types to controls and encodes values back', () => {
    const bool = gsettingsField(key({ type: 'b', value: 'true' }));
    expect([bool.field.kind, bool.value, bool.encode(false)]).toEqual([
      'bool',
      true,
      'false',
    ]);

    const enumKey = gsettingsField(
      key({ value: "'block'", enum: ['block', 'ibeam'] }),
    );
    expect([
      enumKey.field.kind,
      enumKey.value,
      enumKey.encode('ibeam'),
    ]).toEqual(['enum', 'block', "'ibeam'"]);

    const range = gsettingsField(
      key({ type: 'd', value: '0.5', range: { min: 0, max: 1 } }),
    );
    expect([range.field.kind, range.value, range.encode(1)]).toEqual([
      'range',
      0.5,
      '1.0',
    ]);

    const uint = gsettingsField(key({ type: 'u', value: 'uint32 80' }));
    expect([
      uint.field.kind,
      uint.field.integer,
      uint.field.min,
      uint.value,
    ]).toEqual(['number', true, 0, 80]);

    const list = gsettingsField(key({ type: 'as', value: "['a', 'b']" }));
    expect([list.field.kind, list.value, list.encode([])]).toEqual([
      'list',
      ['a', 'b'],
      '@as []',
    ]);

    const flags = gsettingsField(
      key({ type: 'as', value: "['x']", flags: ['x', 'y'] }),
    );
    expect(flags.field.kind).toBe('multi');

    const pairs = gsettingsField(key({ type: 'a(ss)', value: "[('a', 'b')]" }));
    expect([pairs.field.kind, pairs.value, pairs.encode([['c', 'd']])]).toEqual(
      ['pairs', [['a', 'b']], "[('c', 'd')]"],
    );

    const tuple = gsettingsField(
      key({ type: '(uu)', value: '(uint32 80, uint32 24)' }),
    );
    expect([tuple.field.kind, tuple.value, tuple.encode([100, 30])]).toEqual([
      'tuple',
      [80, 24],
      '(100, 30)',
    ]);

    const maybe = gsettingsField(key({ type: 'ms', value: 'nothing' }));
    expect([maybe.value, maybe.encode(''), maybe.encode('x')]).toEqual([
      '',
      '@ms nothing',
      "'x'",
    ]);
  });

  it('edits unsupported types as GVariant text', () => {
    const f = gsettingsField(key({ type: 'a{sv}', value: '@a{sv} {}' }));
    expect([f.field.kind, f.value, f.encode('{}')]).toEqual([
      'text',
      '@a{sv} {}',
      '{}',
    ]);
  });

  it('gives the Ptyxis palette key a picker, or validated text without a list', () => {
    const palette = key({ name: 'palette', value: "'Ubuntu'" });
    const picker = gsettingsField(palette, { palettes: ['Dracula', 'Ubuntu'] });
    expect([picker.field.kind, picker.field.options]).toEqual([
      'theme',
      ['Dracula', 'Ubuntu'],
    ]);
    const text = gsettingsField(palette, { palettes: null });
    expect(text.field.kind).toBe('text');
    expect(text.field.validate?.('a/b')).toMatch(/cannot contain/);
    expect(validatePaletteName('Catppuccin Mocha')).toBeNull();
    expect(validatePaletteName(' ')).toMatch(/Enter/);
    // Not a profile form: a plain text field.
    expect(gsettingsField(palette).field.kind).toBe('text');
  });
});

describe('latestBackupFor', () => {
  it('picks the newest backup that covers the terminal', () => {
    const refs = [
      { ts: '20261108T010000Z', path: '/a', kinds: ['ptyxis' as const] },
      {
        ts: '20261108T030000Z',
        path: '/c',
        kinds: ['gnome-terminal' as const],
      },
      { ts: '20261108T020000Z-1', path: '/b', kinds: ['ptyxis' as const] },
    ];
    expect(latestBackupFor(refs, 'ptyxis')?.path).toBe('/b');
    expect(latestBackupFor([], 'ptyxis')).toBeNull();
  });
});
