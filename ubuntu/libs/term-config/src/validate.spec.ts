import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_IDS } from './api';
import { parseGhosttySchema } from './ghostty/schema';
import { parseGSchema } from './gschema';
import {
  formatBackupTimestamp,
  isBackupTimestamp,
  isFileId,
  isGhosttyKey,
  isProfileUuid,
  isSchemaId,
  isSchemaKey,
  isShellName,
  isTerminalKind,
} from './validate';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('identifier validators', () => {
  it('accepts only allowlisted file ids', () => {
    for (const id of FILE_IDS) expect(isFileId(id)).toBe(true);
    for (const bad of [
      '../.bashrc',
      '/etc/passwd',
      'BASHRC',
      '',
      1,
      null,
      'bashrc ',
    ]) {
      expect(isFileId(bad)).toBe(false);
    }
  });

  it('accepts shell names and terminal kinds', () => {
    expect(isShellName('zsh')).toBe(true);
    expect(isShellName('fish')).toBe(false);
    expect(isTerminalKind('gnome-terminal')).toBe(true);
    expect(isTerminalKind('kitty')).toBe(false);
  });

  it('accepts backup timestamps that are real UTC times', () => {
    expect(isBackupTimestamp('20261108T074455Z')).toBe(true);
    expect(isBackupTimestamp('20261108T074455Z-2')).toBe(true);
    for (const bad of [
      '20261308T074455Z',
      '20260230T000000Z',
      '20261108T246000Z',
      '20261108T074455',
      '20261108T074455Z-',
      '../20261108T074455Z',
      '20261108T074455Z\n',
    ]) {
      expect(isBackupTimestamp(bad)).toBe(false);
    }
  });

  it('formats backup timestamps that validate', () => {
    const date = new Date('2026-11-08T07:44:55.123Z');
    expect(formatBackupTimestamp(date)).toBe('20261108T074455Z');
    expect(formatBackupTimestamp(date, 3)).toBe('20261108T074455Z-3');
    expect(isBackupTimestamp(formatBackupTimestamp(date, 3))).toBe(true);
  });

  it('checks profile uuids per terminal', () => {
    expect(isProfileUuid('ptyxis', '91d0e1138a06858802ff88506ae490ea')).toBe(
      true,
    );
    expect(
      isProfileUuid('ptyxis', 'b1dcc9dd-5262-4d8d-a863-c897e6d979b9'),
    ).toBe(false);
    expect(
      isProfileUuid('gnome-terminal', 'b1dcc9dd-5262-4d8d-a863-c897e6d979b9'),
    ).toBe(true);
    expect(
      isProfileUuid('gnome-terminal', '91d0e1138a06858802ff88506ae490ea'),
    ).toBe(false);
    expect(
      isProfileUuid('ptyxis', '91d0e1138a06858802ff88506ae490ea/../x'),
    ).toBe(false);
  });

  it('checks schema ids against the inventory', () => {
    const known = ['org.gnome.Ptyxis', 'org.gnome.Ptyxis.Profile'];
    expect(isSchemaId('org.gnome.Ptyxis', known)).toBe(true);
    expect(isSchemaId('org.gnome.Terminal.Legacy.Profile', known)).toBe(false);
    expect(
      isSchemaId('org.gnome.Ptyxis:/x/', [...known, 'org.gnome.Ptyxis:/x/']),
    ).toBe(false);
  });

  it('checks key names against parsed schemas', () => {
    const [global] = parseGSchema(fixture('org.gnome.Ptyxis.gschema.xml'));
    expect(isSchemaKey('audible-bell', global)).toBe(true);
    expect(isSchemaKey('label', global)).toBe(false);
    expect(isSchemaKey('audible-bell; rm', global)).toBe(false);
    const ghostty = parseGhosttySchema(fixture('ghostty-show-config-docs.txt'));
    expect(isGhosttyKey('font-family', ghostty)).toBe(true);
    expect(isGhosttyKey('not-a-key', ghostty)).toBe(false);
  });
});
