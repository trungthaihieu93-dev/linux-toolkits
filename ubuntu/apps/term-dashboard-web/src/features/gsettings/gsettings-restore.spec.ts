import { describeGSettingsRestore } from './gsettings-restore';

describe('describeGSettingsRestore', () => {
  it('names the backup taken before the restore', () => {
    expect(
      describeGSettingsRestore({
        restored: ['ptyxis', 'gnome-terminal'],
        backup: {
          ts: '20261108T050000Z',
          path: '/home/u/.local/state/term-dashboard/backups/20261108T050000Z/gsettings.json',
          kinds: ['ptyxis', 'gnome-terminal'],
        },
      }),
    ).toBe(
      'Restored: ptyxis, gnome-terminal. The settings from before the restore are backed up in /home/u/.local/state/term-dashboard/backups/20261108T050000Z/gsettings.json; restore that backup on the Backups page to undo.',
    );
  });

  it('says only what was restored when no backup was taken', () => {
    expect(describeGSettingsRestore({ restored: [], backup: null })).toBe(
      'Restored: nothing.',
    );
    expect(describeGSettingsRestore({ restored: ['ptyxis'] })).toBe(
      'Restored: ptyxis.',
    );
  });
});
