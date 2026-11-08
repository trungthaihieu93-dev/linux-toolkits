// @vitest-environment jsdom
import {
  API_PATHS,
  type ShellFileView,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Link, RouterProvider, useRouter } from '../../app/router';
import { ShellDataProvider } from '../../app/shell-data';
import { ToastProvider } from '../../components/ui/toast';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ApiContext, type ApiClient } from '../../lib/api';
import { ShellPage } from './shell-page';

// Monaco does not run in jsdom: a textarea stands in for the editor.
vi.mock('../monaco/lazy-editors', () => ({
  LazyCodeEditor: (p: {
    value: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={p.ariaLabel}
      value={p.value}
      readOnly={p.readOnly}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
  LazyDiffViewer: () => null,
}));

const CONTENT = "# ~/.bashrc\nalias ls='ls --color=auto'\n";

const VIEW: ShellFileView = {
  shell: 'bash',
  fileId: 'bashrc',
  path: '/home/u/.bashrc',
  exists: true,
  content: CONTENT,
  mtimeMs: 1000,
  configMode: true,
  blocks: {
    main: {
      name: 'term-dashboard',
      present: false,
      startLine: null,
      endLine: null,
    },
    omz: null,
  },
  model: {
    aliases: [],
    exports: [],
    path: { prepend: [], append: [] },
    history: {},
  },
  outside: [
    { line: 2, kind: 'alias', name: 'ls', text: "alias ls='ls --color=auto'" },
  ],
  ohMyZsh: null,
};

const INVENTORY: TerminalInventory = {
  home: '/home/u',
  loginShell: '/bin/bash',
  ghostty: { installed: false, version: null, files: [] },
  terminals: [],
  shells: [
    {
      shell: 'bash',
      installed: true,
      binary: '/bin/bash',
      isLoginShell: true,
      files: [{ id: 'bashrc', path: '/home/u/.bashrc', exists: true }],
      managedBlock: false,
      ohMyZsh: false,
      lastBackup: null,
    },
  ],
  pty: { available: true },
};

function fakeApi(view: ShellFileView = VIEW): ApiClient {
  const get = async (path: string): Promise<unknown> => {
    if (path === API_PATHS.shellFile('bash', 'bashrc')) return view;
    if (path === API_PATHS.inventory) return INVENTORY;
    if (path === API_PATHS.health)
      return { app: 'term-dashboard', version: '0', pid: 1 };
    throw new Error(`unexpected GET ${path}`);
  };
  return {
    token: 't',
    fetch: () => Promise.reject(new Error('no fetch in this test')),
    request: ((method: string, path: string) =>
      method === 'GET'
        ? get(path)
        : Promise.reject(
            new Error(`unexpected ${method}`),
          )) as ApiClient['request'],
    get: get as ApiClient['get'],
    health: () => get(API_PATHS.health) as ReturnType<ApiClient['health']>,
    settings: () => Promise.reject(new Error('unused')),
    updateSettings: () => Promise.reject(new Error('unused')),
    inventory: () =>
      get(API_PATHS.inventory) as ReturnType<ApiClient['inventory']>,
  };
}

function CurrentPath() {
  return <output aria-label="current path">{useRouter().path}</output>;
}

async function mount() {
  window.history.replaceState(null, '', '/shells/bash');
  render(
    <RouterProvider>
      <TooltipProvider>
        <ToastProvider>
          <ApiContext.Provider value={fakeApi()}>
            <ShellDataProvider>
              <Link to="/">Overview</Link>
              <CurrentPath />
              <ShellPage shell="bash" />
            </ShellDataProvider>
          </ApiContext.Provider>
        </ToastProvider>
      </TooltipProvider>
    </RouterProvider>,
  );
  await screen.findByRole('region', { name: 'Aliases' });
}

// hidden: an open dialog marks the page aria-hidden.
const tab = (name: string) => screen.getByRole('tab', { name, hidden: true });
// Radix tabs activate on mouse down.
const pressTab = (name: string) =>
  fireEvent.mouseDown(tab(name), { button: 0 });

async function addAlias() {
  fireEvent.click(screen.getByRole('button', { name: 'Add aliases' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name 1' }), {
    target: { value: 'gs' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Command 1' }), {
    target: { value: 'git status' },
  });
  await screen.findByText('1 file with unsaved changes');
}

afterEach(cleanup);

describe('ShellPage mode switch', () => {
  it('switches modes at once when nothing is unsaved', async () => {
    await mount();
    pressTab('Monaco');
    const editor = await screen.findByRole('textbox', {
      name: '.bashrc editor',
    });
    expect((editor as HTMLTextAreaElement).value).toBe(CONTENT);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before discarding Config-mode edits, and keeps them on "Keep editing"', async () => {
    await mount();
    await addAlias();

    pressTab('Monaco');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Discard unsaved changes?');
    expect(tab('Config').getAttribute('data-state')).toBe('active');

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(tab('Config').getAttribute('data-state')).toBe('active');
    // The page is aria-hidden until the dialog has fully unmounted.
    expect(
      (
        (await screen.findByRole('textbox', {
          name: 'Name 1',
        })) as HTMLInputElement
      ).value,
    ).toBe('gs');

    pressTab('Monaco');
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    const editor = await screen.findByRole('textbox', {
      name: '.bashrc editor',
    });
    expect((editor as HTMLTextAreaElement).value).toBe(CONTENT);

    // Back in Config mode the discarded alias is gone.
    pressTab('Config');
    await screen.findByRole('region', { name: 'Aliases' });
    expect(screen.queryByRole('textbox', { name: 'Name 1' })).toBeNull();
  });

  it('guards Monaco edits on mode switch and on navigation', async () => {
    await mount();
    pressTab('Monaco');
    const editor = await screen.findByRole('textbox', {
      name: '.bashrc editor',
    });
    fireEvent.change(editor, { target: { value: `${CONTENT}echo hi\n` } });

    fireEvent.click(screen.getByRole('link', { name: 'Overview' }));
    await screen.findByRole('alertdialog');
    expect(screen.getByLabelText('current path').textContent).toBe(
      '/shells/bash',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    pressTab('Config');
    await screen.findByRole('alertdialog');
    expect(tab('Monaco').getAttribute('data-state')).toBe('active');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await screen.findByRole('region', { name: 'Aliases' });
  });

  it('"Edit in Monaco at line N" opens Monaco mode', async () => {
    await mount();
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit in Monaco at line 2' }),
    );
    await screen.findByRole('textbox', { name: '.bashrc editor' });
    expect(tab('Monaco').getAttribute('data-state')).toBe('active');
  });
});

describe('ShellPage with a file td will not write', () => {
  const REASON = '/home/u/.bashrc is not valid UTF-8; td will not write it';

  it('shows the reason and offers no way to edit or save', async () => {
    window.history.replaceState(null, '', '/shells/bash');
    render(
      <RouterProvider>
        <TooltipProvider>
          <ToastProvider>
            <ApiContext.Provider value={fakeApi({ ...VIEW, readOnly: REASON })}>
              <ShellDataProvider>
                <ShellPage shell="bash" />
              </ShellDataProvider>
            </ApiContext.Provider>
          </ToastProvider>
        </TooltipProvider>
      </RouterProvider>,
    );
    const editor = (await screen.findByRole('textbox', {
      name: '.bashrc editor',
    })) as HTMLTextAreaElement;
    expect(screen.getByRole('note').textContent).toContain(REASON);
    expect(editor.readOnly).toBe(true);
    expect(tab('Config').hasAttribute('disabled')).toBe(true);
    expect(tab('Monaco').getAttribute('data-state')).toBe('active');
    expect(screen.queryByRole('region', { name: 'Aliases' })).toBeNull();

    // Even a change event that gets through leaves nothing to save.
    fireEvent.change(editor, { target: { value: `${CONTENT}echo hi\n` } });
    expect(screen.queryByRole('button', { name: 'Review and save' })).toBe(
      null,
    );
    expect(editor.value).toBe(CONTENT);
  });
});

describe('ShellPage after a save', () => {
  interface Deferred {
    resolve: (view: ShellFileView) => void;
  }

  /** First file read answers at once; later reads wait for the test. */
  function savingApi() {
    const reads: Deferred[] = [];
    const posts: { path: string; body: unknown }[] = [];
    const base = fakeApi();
    let first = true;
    const get = (path: string): Promise<unknown> => {
      if (path !== API_PATHS.shellFile('bash', 'bashrc')) return base.get(path);
      if (first) {
        first = false;
        return Promise.resolve(VIEW);
      }
      return new Promise((resolve) => reads.push({ resolve }));
    };
    const request = ((method: string, path: string, body?: unknown) => {
      if (method === 'GET') return get(path);
      posts.push({ path, body });
      const content = (body as { content: string }).content;
      if (path === API_PATHS.shellRaw('bash', 'preview'))
        return Promise.resolve({
          fileId: 'bashrc',
          path: VIEW.path,
          diff: '+x\n',
          changed: true,
          check: { ok: true, argv: [], output: '' },
          baseMtimeMs: 1000,
          candidate: content,
        });
      if (path === API_PATHS.shellRaw('bash', 'save'))
        return Promise.resolve({
          fileId: 'bashrc',
          path: VIEW.path,
          mtimeMs: 2000,
          backup: null,
          check: { ok: true, argv: [], output: '' },
        });
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    }) as ApiClient['request'];
    const api: ApiClient = {
      ...base,
      request,
      get: get as ApiClient['get'],
    };
    return { api, reads, posts };
  }

  it('uses the saved mtime at once and keeps edits typed while the file reloads', async () => {
    const { api, reads, posts } = savingApi();
    window.history.replaceState(null, '', '/shells/bash');
    render(
      <RouterProvider>
        <TooltipProvider>
          <ToastProvider>
            <ApiContext.Provider value={api}>
              <ShellDataProvider>
                <ShellPage shell="bash" />
              </ShellDataProvider>
            </ApiContext.Provider>
          </ToastProvider>
        </TooltipProvider>
      </RouterProvider>,
    );
    await screen.findByRole('region', { name: 'Aliases' });
    pressTab('Monaco');
    const editor = () =>
      screen.getByRole('textbox', {
        name: '.bashrc editor',
        hidden: true,
      }) as HTMLTextAreaElement;
    await screen.findByRole('textbox', { name: '.bashrc editor' });

    const saved = `${CONTENT}echo 1\n`;
    fireEvent.change(editor(), { target: { value: saved } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBe(
        null,
      ),
    );
    await waitFor(() => expect(reads).toHaveLength(1));

    // Typed while the reload is still running: the next save already uses
    // the mtime of the save, not the one read before it.
    const typed = `${saved}echo 2\n`;
    fireEvent.change(editor(), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2]).toEqual({
      path: API_PATHS.shellRaw('bash', 'preview'),
      body: { fileId: 'bashrc', baseMtimeMs: 2000, content: typed },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(async () => {
      reads[0].resolve({ ...VIEW, content: saved, mtimeMs: 2000 });
    });
    await screen.findByText('1 file with unsaved changes');
    expect(editor().value).toBe(typed);
  });
});
