import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSchemaView,
  GSchemaError,
  parseGSchema,
  parseGSchemaFiles,
} from './gschema';
import { parseGSettingsList } from './gsettings-list';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const ptyxis = parseGSchema(fixture('org.gnome.Ptyxis.gschema.xml'));
const byId = (id: string) => {
  const s = ptyxis.find((x) => x.schemaId === id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe('parseGSchema on the Ptyxis schema', () => {
  it('yields 89 keys across the three schemas', () => {
    expect(ptyxis.map((s) => [s.schemaId, s.path, s.keys.length])).toEqual([
      ['org.gnome.Ptyxis', '/org/gnome/Ptyxis/', 27],
      ['org.gnome.Ptyxis.Profile', undefined, 22],
      ['org.gnome.Ptyxis.Shortcuts', '/org/gnome/Ptyxis/Shortcuts/', 40],
    ]);
    expect(ptyxis.reduce((n, s) => n + s.keys.length, 0)).toBe(89);
  });

  it('resolves every enum key to its nicks', () => {
    const enumKeys = ptyxis.flatMap((s) => s.keys.filter((k) => k.enum));
    expect(enumKeys.length).toBeGreaterThanOrEqual(12);
    for (const k of enumKeys) {
      expect(k.type).toBe('s');
      expect(k.enum?.length).toBeGreaterThan(1);
      expect(k.enum).toContain(k.default.replace(/^'|'$/g, ''));
    }
    const shape = byId('org.gnome.Ptyxis').keys.find(
      (k) => k.name === 'interface-style',
    );
    expect(shape?.enum).toEqual(['system', 'light', 'dark']);
  });

  it('reads types, ranges, defaults and summaries', () => {
    const global = byId('org.gnome.Ptyxis').keys;
    const cols = global.find((k) => k.name === 'default-columns');
    expect(cols).toMatchObject({
      type: 'u',
      default: '80',
      range: { min: 1, max: 65535 },
      summary: 'Default Column Size',
    });
    expect(global.find((k) => k.name === 'window-size')).toMatchObject({
      type: '(uu)',
      default: '(0,0)',
      summary: '',
    });
    expect(global.find((k) => k.name === 'word-char-exceptions')?.type).toBe(
      'ms',
    );
    const profile = byId('org.gnome.Ptyxis.Profile').keys;
    expect(profile.find((k) => k.name === 'opacity')?.range).toEqual({
      min: 0,
      max: 1,
    });
    expect(profile.find((k) => k.name === 'custom-links')?.type).toBe('a(ss)');
  });

  it('ignores comments, including ones inside keys', () => {
    const osc = byId('org.gnome.Ptyxis').keys.find(
      (k) => k.name === 'ignore-osc-title',
    );
    expect(osc?.summary).toBe('Ignore OSC Title');
  });
});

describe('parseGSchemaFiles', () => {
  const enums = `<schemalist>
  <enum id="t.Mode"><value nick="a" value="0"/><value nick="b&amp;c" value="1"/></enum>
  <flags id="t.Flags"><value nick="x" value="1"/><value nick="y" value="2"/></flags>
</schemalist>`;
  const schema = `<schemalist>
  <schema id="t.S" path="/t/s/">
    <key name="mode" enum="t.Mode"><default>'a'</default></key>
    <key name="flags" flags="t.Flags"><default>[]</default></key>
    <key name="pick" type="s">
      <choices><choice value="one"/><choice value="two"/></choices>
      <default l10n="messages">'one'</default>
      <summary>Pick &lt;one&gt;</summary>
      <description>
        Spread over
        lines
      </description>
    </key>
  </schema>
</schemalist>`;

  it('resolves enums and flags from a separate file', () => {
    const [s] = parseGSchemaFiles([enums, schema]);
    expect(s.keys).toEqual([
      {
        name: 'mode',
        type: 's',
        enum: ['a', 'b&c'],
        summary: '',
        description: '',
        default: "'a'",
      },
      {
        name: 'flags',
        type: 'as',
        flags: ['x', 'y'],
        summary: '',
        description: '',
        default: '[]',
      },
      {
        name: 'pick',
        type: 's',
        choices: ['one', 'two'],
        summary: 'Pick <one>',
        description: 'Spread over lines',
        default: "'one'",
      },
    ]);
  });

  it('fails on an unknown enum instead of guessing', () => {
    expect(() => parseGSchemaFiles([schema])).toThrow(GSchemaError);
  });

  it('fails on a key without type or default', () => {
    expect(() =>
      parseGSchema(
        '<schema id="a"><key name="k"><default>1</default></key></schema>',
      ),
    ).toThrow(/no type/);
    expect(() =>
      parseGSchema('<schema id="a"><key name="k" type="b"></key></schema>'),
    ).toThrow(/no default/);
  });
});

describe('buildSchemaView', () => {
  const global = byId('org.gnome.Ptyxis');
  const values = parseGSettingsList(fixture('ptyxis-list-recursively.txt'))[
    'org.gnome.Ptyxis'
  ];

  it('marks keys equal to the effective default, comparing values not text', () => {
    const view = buildSchemaView(global, values, {
      'interface-style': "'dark'",
    });
    expect(view.schema).toBe('org.gnome.Ptyxis');
    expect(view.path).toBe('/org/gnome/Ptyxis/');
    expect(view.keys).toHaveLength(27);
    const key = (n: string) => view.keys.find((k) => k.name === n);
    expect(key('default-columns')).toMatchObject({
      value: 'uint32 80',
      default: '80',
      isDefault: true,
    });
    expect(key('interface-style')).toMatchObject({
      enum: ['system', 'light', 'dark'],
      isDefault: true,
    });
    expect(key('window-size')?.isDefault).toBe(false);
    expect(key('enable-a11y')?.isDefault).toBe(false);
  });

  it('uses the default for keys without a value and takes an explicit path', () => {
    const profile = byId('org.gnome.Ptyxis.Profile');
    const view = buildSchemaView(
      profile,
      {},
      {},
      '/org/gnome/Ptyxis/Profiles/x/',
    );
    expect(view.path).toBe('/org/gnome/Ptyxis/Profiles/x/');
    expect(view.keys.every((k) => k.isDefault && k.value === k.default)).toBe(
      true,
    );
  });
});
