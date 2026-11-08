// @vitest-environment jsdom
import {
  API_PATHS,
  type GSettingsTerminalSchemas,
  type TerminalProfilesView,
} from '@linux-toolchain/term-config';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '../../components/ui/toast';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ApiContext, ApiRequestError, type ApiClient } from '../../lib/api';
import { ProfilesPanel } from './profiles-panel';

const DEFAULT = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

const SCHEMAS: GSettingsTerminalSchemas = {
  global: { schema: 'org.gnome.Ptyxis', path: null },
  shortcuts: null,
  profileList: { schema: 'org.gnome.Ptyxis', path: null, key: 'profile-uuids' },
  defaultProfile: {
    schema: 'org.gnome.Ptyxis',
    path: null,
    key: 'default-profile-uuid',
  },
  profile: 'org.gnome.Ptyxis.Profile',
  profilePathPrefix: '/org/gnome/Ptyxis/Profiles/',
  labelKey: 'label',
};

const PROFILES: TerminalProfilesView = {
  kind: 'ptyxis',
  defaultUuid: DEFAULT,
  profiles: [
    { uuid: DEFAULT, label: 'Main', isDefault: true },
    { uuid: OTHER, label: 'Work', isDefault: false },
  ],
};

function fakeApi(): ApiClient {
  const request = ((method: string, path: string) => {
    if (method === 'GET' && path === API_PATHS.terminalProfiles('ptyxis'))
      return Promise.resolve(PROFILES);
    if (method === 'GET')
      return Promise.resolve({ schema: SCHEMAS.profile, path, keys: [] });
    if (
      method === 'DELETE' &&
      path === API_PATHS.terminalProfile('ptyxis', OTHER)
    )
      // The default changed elsewhere since the list was read.
      return Promise.reject(
        new ApiRequestError(422, 'the default profile cannot be deleted'),
      );
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  }) as ApiClient['request'];
  return {
    token: 't',
    fetch: () => Promise.reject(new Error('unused')),
    request,
    get: ((path: string) => request('GET', path)) as ApiClient['get'],
    health: () => Promise.reject(new Error('unused')),
    settings: () => Promise.reject(new Error('unused')),
    updateSettings: () => Promise.reject(new Error('unused')),
    inventory: () => Promise.reject(new Error('unused')),
  };
}

afterEach(cleanup);

describe('ProfilesPanel', () => {
  it('shows the server message when a delete is refused', async () => {
    render(
      <TooltipProvider>
        <ToastProvider>
          <ApiContext.Provider value={fakeApi()}>
            <ProfilesPanel kind="ptyxis" schemas={SCHEMAS} />
          </ApiContext.Provider>
        </ToastProvider>
      </TooltipProvider>,
    );
    expect(
      (
        (await screen.findByRole('button', {
          name: 'Delete Main',
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Could not delete the profile'),
    ).toBeTruthy();
    expect(
      screen.getByText('the default profile cannot be deleted'),
    ).toBeTruthy();
  });
});
