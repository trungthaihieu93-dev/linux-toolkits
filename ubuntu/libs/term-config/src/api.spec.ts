import { API_PATHS } from './api';

describe('API_PATHS', () => {
  it('builds the profile, reset and backup action routes the server serves', () => {
    const uuid = '0123456789abcdef0123456789abcdef';
    expect(API_PATHS.terminalProfileDuplicate('ptyxis', uuid)).toBe(
      `/api/terminals/ptyxis/profiles/${uuid}/duplicate`,
    );
    expect(API_PATHS.terminalProfileDefault('gnome-terminal', uuid)).toBe(
      `/api/terminals/gnome-terminal/profiles/${uuid}/default`,
    );
    expect(API_PATHS.terminalReset(API_PATHS.terminalGlobal('ptyxis'))).toBe(
      '/api/terminals/ptyxis/global/reset',
    );
    expect(
      API_PATHS.backupFileAction('bashrc', '20261108T050000Z-1', 'restore'),
    ).toBe('/api/backups/files/bashrc/20261108T050000Z-1/restore');
  });
});
