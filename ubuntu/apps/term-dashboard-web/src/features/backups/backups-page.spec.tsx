// @vitest-environment jsdom
import {
  API_PATHS,
  type BackupContent,
  type BackupsView,
  type GSettingsRestoreResult,
  type SavePreview,
} from '@linux-toolchain/term-config';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ToastProvider } from '../../components/ui/toast';
import { ApiContext, type ApiClient } from '../../lib/api';
import { formatBackupTs } from '../../lib/format';
import { BackupsPage } from './backups-page';

vi.mock('../monaco/lazy-editors', () => ({
  LazyCodeEditor: (p: { value: string; ariaLabel: string }) => (
    <textarea aria-label={p.ariaLabel} value={p.value} readOnly />
  ),
  LazyDiffViewer: () => null,
}));

const TS = '20261108T040000Z';
const GS_TS = '20261108T030000Z';
const UNDO_PATH =
  '/home/u/.local/state/term-dashboard/backups/20261108T050000Z/gsettings.json';
const REASON =
  '/home/u/.local/state/term-dashboard/backups/20261108T040000Z/bashrc is not valid UTF-8; td will not restore it (copy the file back yourself)';

const VIEW: BackupsView = {
  dir: '/home/u/.local/state/term-dashboard/backups',
  files: [
    {
      fileId: 'bashrc',
      ts: TS,
      path: `/home/u/.local/state/term-dashboard/backups/${TS}/bashrc`,
      size: 12,
    },
  ],
  gsettings: [
    {
      ts: GS_TS,
      path: `/home/u/.local/state/term-dashboard/backups/${GS_TS}/gsettings.json`,
      kinds: ['ptyxis'],
    },
  ],
};

function fakeApi(content: BackupContent) {
  const calls: { method: string; path: string }[] = [];
  const request = (async (method: string, path: string) => {
    calls.push({ method, path });
    if (path === API_PATHS.backups) return VIEW;
    if (path === API_PATHS.backupFile('bashrc', TS)) return content;
    if (path === API_PATHS.backupFileAction('bashrc', TS, 'preview'))
      return {
        fileId: 'bashrc',
        path: '/home/u/.bashrc',
        diff: '-a\n+b\n',
        changed: true,
        check: { ok: true, argv: [], output: '' },
        baseMtimeMs: 1,
        candidate: content.content,
      } satisfies SavePreview;
    if (path === API_PATHS.gsettingsRestore(GS_TS))
      return {
        restored: ['ptyxis'],
        backup: { ts: '20261108T050000Z', path: UNDO_PATH, kinds: ['ptyxis'] },
      } satisfies GSettingsRestoreResult;
    throw new Error(`unexpected ${method} ${path}`);
  }) as ApiClient['request'];
  const api: ApiClient = {
    token: 't',
    fetch: () => Promise.reject(new Error('unused')),
    request,
    get: ((path: string) => request('GET', path)) as ApiClient['get'],
    health: () => Promise.reject(new Error('unused')),
    settings: () => Promise.reject(new Error('unused')),
    updateSettings: () => Promise.reject(new Error('unused')),
    inventory: () => Promise.reject(new Error('unused')),
  };
  return { api, calls };
}

async function mount(content: BackupContent) {
  const fake = fakeApi(content);
  render(
    <ToastProvider>
      <ApiContext.Provider value={fake.api}>
        <BackupsPage />
      </ApiContext.Provider>
    </ToastProvider>,
  );
  await screen.findByRole('region', { name: 'File backups' });
  return fake;
}

const ref = VIEW.files[0];
const restoreButton = () =>
  screen.getByRole('button', {
    name: `Restore bashrc from ${formatBackupTs(TS)}`,
  });
const previews = (calls: { method: string; path: string }[]) =>
  calls.filter(
    (c) => c.path === API_PATHS.backupFileAction('bashrc', TS, 'preview'),
  );

afterEach(cleanup);

describe('BackupsPage with a backup td will not restore', () => {
  const readOnly: BackupContent = {
    ref,
    content: '# caf�\n',
    readOnly: REASON,
  };

  it('shows the reason in the viewer', async () => {
    await mount(readOnly);
    fireEvent.click(
      screen.getByRole('button', {
        name: `View bashrc backup from ${formatBackupTs(TS)}`,
      }),
    );
    const note = await screen.findByRole('note');
    expect(note.textContent).toBe(REASON);
  });

  it('refuses Restore with the reason and asks for no preview', async () => {
    const fake = await mount(readOnly);
    fireEvent.click(restoreButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('bashrc was not restored');
    expect(alert.textContent).toContain(REASON);
    expect(previews(fake.calls)).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('BackupsPage restore', () => {
  it('previews a UTF-8 backup before restoring it', async () => {
    const fake = await mount({ ref, content: '# ok\n' });
    fireEvent.click(restoreButton());
    await waitFor(() => expect(previews(fake.calls)).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('names the backup taken before a gsettings restore and lists it', async () => {
    const fake = await mount({ ref, content: '# ok\n' });
    const listed = () =>
      fake.calls.filter((c) => c.path === API_PATHS.backups).length;
    expect(listed()).toBe(1);
    fireEvent.click(
      screen.getByRole('button', {
        name: `Restore gsettings from ${formatBackupTs(GS_TS)}`,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    const toast = await screen.findByText(/^Restored: ptyxis\./);
    expect(toast.textContent).toContain(UNDO_PATH);
    await waitFor(() => expect(listed()).toBe(2));
  });
});
