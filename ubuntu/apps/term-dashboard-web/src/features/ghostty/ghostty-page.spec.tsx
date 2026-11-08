// @vitest-environment jsdom
import {
  API_PATHS,
  type GhosttyConfigView,
  type GhosttySaveResult,
  type GhosttySchema,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { RouterProvider } from '../../app/router';
import { ShellDataProvider } from '../../app/shell-data';
import { ToastProvider } from '../../components/ui/toast';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ApiContext, type ApiClient } from '../../lib/api';
import { GhosttyPage } from './ghostty-page';

vi.mock('../monaco/lazy-editors', () => ({
  LazyCodeEditor: () => null,
  LazyDiffViewer: () => null,
}));

const SCHEMA: GhosttySchema = {
  version: '1.4.0',
  keys: [
    {
      key: 'font-size',
      doc: '',
      default: '13',
      defaults: ['13'],
      repeatable: false,
      control: 'number',
    },
    {
      key: 'window-padding-x',
      doc: '',
      default: '2',
      defaults: ['2'],
      repeatable: false,
      control: 'number',
    },
  ],
};

function config(
  entries: { key: string; value: string }[],
  mtimeMs: number,
): GhosttyConfigView {
  return {
    files: [
      {
        id: 'ghostty',
        path: '/home/u/.config/ghostty/config.ghostty',
        exists: true,
        mtimeMs,
        includes: [],
        entries: entries.map((e, i) => ({ ...e, line: i + 1 })),
      },
    ],
    effective: {},
    conflicts: [],
  };
}

const INVENTORY: TerminalInventory = {
  home: '/home/u',
  loginShell: '/bin/bash',
  ghostty: { installed: true, version: '1.4.0', files: [] },
  terminals: [],
  shells: [],
  pty: { available: true },
};

interface Fake {
  api: ApiClient;
  calls: { method: string; path: string; body: unknown }[];
  /** Successive GET /api/ghostty/config answers (null: the read fails). */
  configs: (GhosttyConfigView | null)[];
}

function fakeApi(configs: (GhosttyConfigView | null)[]): Fake {
  const calls: Fake['calls'] = [];
  const fake: Fake = { api: null as unknown as ApiClient, calls, configs };
  let reads = 0;
  const request = (async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === API_PATHS.ghosttySchema) return SCHEMA;
    if (path === API_PATHS.ghosttyConfig) {
      const view = configs[Math.min(reads, configs.length - 1)];
      reads += 1;
      if (view) return view;
      throw new Error('config read failed');
    }
    if (path === API_PATHS.ghosttyThemes || path === API_PATHS.ghosttyFonts)
      return { names: [] };
    if (path === API_PATHS.inventory) return INVENTORY;
    if (path === API_PATHS.health)
      return { app: 'term-dashboard', version: '0', pid: 1 };
    if (path === API_PATHS.ghosttyPreview)
      return {
        previews: [
          {
            fileId: 'ghostty',
            path: '/home/u/.config/ghostty/config.ghostty',
            diff: '-a\n+b\n',
            changed: true,
            check: { ok: true, argv: [], output: '' },
            baseMtimeMs: 1,
            candidate: 'font-size = 16\n',
          },
        ],
        warnings: [],
      };
    if (path === API_PATHS.ghosttySave)
      return {
        results: [
          {
            fileId: 'ghostty',
            path: '/home/u/.config/ghostty/config.ghostty',
            mtimeMs: 2,
            backup: null,
            check: { ok: true, argv: [], output: '' },
          },
        ],
        warnings: [],
      } satisfies GhosttySaveResult;
    throw new Error(`unexpected ${method} ${path}`);
  }) as ApiClient['request'];
  fake.api = {
    token: 't',
    fetch: () => Promise.reject(new Error('unused')),
    request,
    get: ((path: string) => request('GET', path)) as ApiClient['get'],
    health: () => request('GET', API_PATHS.health),
    settings: () => Promise.reject(new Error('unused')),
    updateSettings: () => Promise.reject(new Error('unused')),
    inventory: () => request('GET', API_PATHS.inventory),
  };
  return fake;
}

async function mount(configs: (GhosttyConfigView | null)[]) {
  const fake = fakeApi(configs);
  window.history.replaceState(null, '', '/ghostty');
  render(
    <RouterProvider>
      <TooltipProvider>
        <ToastProvider>
          <ApiContext.Provider value={fake.api}>
            <ShellDataProvider>
              <GhosttyPage />
            </ShellDataProvider>
          </ApiContext.Provider>
        </ToastProvider>
      </TooltipProvider>
    </RouterProvider>,
  );
  await screen.findByRole('region', { name: 'Ghostty settings' });
  return fake;
}

const box = (name: string) =>
  screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const reviewButton = () =>
  screen.getByRole('button', { name: 'Review and save' }) as HTMLButtonElement;

afterEach(cleanup);

describe('GhosttyPage invalid values', () => {
  it('disables saving while a number box shows invalid text', async () => {
    await mount([config([{ key: 'font-size', value: '12' }], 1)]);
    fireEvent.change(box('font-size'), { target: { value: '16' } });
    await screen.findByText('1 unsaved change');
    expect(reviewButton().disabled).toBe(false);

    fireEvent.change(box('window-padding-x'), { target: { value: '' } });
    await waitFor(() => expect(reviewButton().disabled).toBe(true));
    expect(
      screen.getByText('Fix the invalid values above to save.'),
    ).toBeTruthy();

    fireEvent.change(box('window-padding-x'), { target: { value: '4' } });
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
  });

  it('Discard also clears invalid text', async () => {
    await mount([config([{ key: 'font-size', value: '12' }], 1)]);
    fireEvent.change(box('font-size'), { target: { value: '16' } });
    fireEvent.change(box('font-size'), { target: { value: '1e' } });
    await waitFor(() => expect(reviewButton().disabled).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBe(
        null,
      ),
    );
    expect(box('font-size').value).toBe('12');
    expect(box('font-size').getAttribute('aria-invalid')).toBeNull();
  });

  it('shows a value that is not a number as text with an error', async () => {
    await mount([config([{ key: 'font-size', value: 'big' }], 1)]);
    const text = screen.getByRole('textbox', {
      name: 'font-size',
    }) as HTMLInputElement;
    expect(text.value).toBe('big');
    expect(text.getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getByText('The config holds “big”, which is not a number.'),
    ).toBeTruthy();
  });
});

describe('GhosttyPage with a file td will not write', () => {
  it('shows the reason and disables the form and saving', async () => {
    const reason =
      '/home/u/.config/ghostty/config.ghostty is not valid UTF-8; td will not write it';
    const view = config([{ key: 'font-size', value: '12' }], 1);
    view.files[0].readOnly = reason;
    const fake = await mount([view]);

    const note = screen.getByRole('note', { name: 'Read-only' });
    expect(note.textContent).toContain(reason);
    expect(box('font-size').disabled).toBe(true);

    // A change that gets through anyway cannot be saved.
    fireEvent.change(box('font-size'), { target: { value: '16' } });
    const button = screen.queryByRole('button', {
      name: 'Review and save',
    }) as HTMLButtonElement | null;
    if (button) {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(
      fake.calls.filter((c) => c.path === API_PATHS.ghosttyPreview),
    ).toEqual([]);

    // Radix tabs activate on mouse down.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'config.ghostty' }), {
      button: 0,
    });
    expect(await screen.findByText('read-only')).toBeTruthy();
  });
});

describe('GhosttyPage with config linked to config.ghostty', () => {
  it('says the two names are one file and shows no conflict', async () => {
    const view = config([{ key: 'font-size', value: '12' }], 1);
    view.files[0].sameFileAs = 'ghostty-legacy';
    view.files.push({
      ...view.files[0],
      id: 'ghostty-legacy',
      path: '/home/u/.config/ghostty/config',
      sameFileAs: undefined,
    });
    await mount([view]);
    expect(screen.queryByText(/Both files set/)).toBeNull();
    expect(box('font-size').value).toBe('12');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'config.ghostty' }), {
      button: 0,
    });
    const note = await screen.findByRole('note', { name: 'Same file' });
    expect(note.textContent).toContain(
      'config.ghostty and config are the same file (a symlink)',
    );
  });
});

describe('GhosttyPage after a save', () => {
  async function save() {
    fireEvent.change(box('font-size'), { target: { value: '16' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and save' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await screen.findByText('Ghostty config saved');
  }

  it('shows the files read after the save, never the old values', async () => {
    await mount([
      config([{ key: 'font-size', value: '12' }], 1),
      config([{ key: 'font-size', value: '16' }], 2),
    ]);
    await save();
    expect(box('font-size').value).toBe('16');
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBe(
      null,
    );
  });

  it('uses the saved mtimes when the files cannot be read again', async () => {
    const fake = await mount([
      config([{ key: 'font-size', value: '12' }], 1),
      null,
    ]);
    await save();
    await screen.findByText('Saved, but the config could not be read again');

    fireEvent.change(box('font-size'), { target: { value: '18' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review and save' }),
    );
    await waitFor(() =>
      expect(
        fake.calls.filter((c) => c.path === API_PATHS.ghosttyPreview),
      ).toHaveLength(2),
    );
    const previews = fake.calls.filter(
      (c) => c.path === API_PATHS.ghosttyPreview,
    );
    expect(previews[1].body).toEqual({
      edits: [{ op: 'set', key: 'font-size', value: '18' }],
      baseMtimes: { ghostty: 2 },
    });
  });
});
