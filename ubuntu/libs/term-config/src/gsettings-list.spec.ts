import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatGSettingsList,
  GSettingsListError,
  parseGSettingsList,
} from './gsettings-list';

const text = readFileSync(
  join(__dirname, '__fixtures__', 'ptyxis-list-recursively.txt'),
  'utf8',
);

describe('parseGSettingsList', () => {
  it('maps every captured key to its GVariant text', () => {
    const listing = parseGSettingsList(text);
    const keys = listing['org.gnome.Ptyxis'];
    expect(Object.keys(listing)).toEqual(['org.gnome.Ptyxis']);
    expect(Object.keys(keys)).toHaveLength(27);
    expect(keys['default-columns']).toBe('uint32 80');
    expect(keys['window-size']).toBe('(uint32 129, uint32 40)');
    expect(keys['word-char-exceptions']).toBe('@ms nothing');
    expect(keys['font-name']).toBe("'Monospace 10'");
  });

  it('round-trips the fixture byte for byte', () => {
    expect(formatGSettingsList(parseGSettingsList(text))).toBe(text);
  });

  it('keeps several schemas apart and ignores blank lines', () => {
    const listing = parseGSettingsList(
      "a.B x 1\n\nc.D y 'two words'\na.B z true\n",
    );
    expect(listing).toEqual({
      'a.B': { x: '1', z: 'true' },
      'c.D': { y: "'two words'" },
    });
  });

  it('rejects malformed lines with the line number', () => {
    expect(() => parseGSettingsList('a.B x 1\nbroken\n')).toThrow(
      GSettingsListError,
    );
    expect(() => parseGSettingsList('a.B x 1\nbroken\n')).toThrow(/line 2/);
  });

  it('formats an empty listing as empty text', () => {
    expect(formatGSettingsList({})).toBe('');
  });
});
