// @vitest-environment jsdom
import {
  API_PATHS,
  type ShellFileView,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import {
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
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={p.ariaLabel}
      value={p.value}
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

function fakeApi(): ApiClient {
  const get = async (path: string): Promise<unknown> => {
    if (path === API_PATHS.shellFile('bash', 'bashrc')) return VIEW;
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
    expect(
      (screen.getByRole('textbox', { name: 'Name 1' }) as HTMLInputElement)
        .value,
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
