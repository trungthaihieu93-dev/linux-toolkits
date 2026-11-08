// @vitest-environment jsdom
import {
  API_PATHS,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { ShellDataProvider } from '../../app/shell-data';
import { ApiContext, type ApiClient } from '../../lib/api';
import { ThemeProvider } from '../../lib/theme';
import { TerminalPage } from './terminal-page';

const { terms, sockets, events } = vi.hoisted(() => ({
  terms: [] as {
    options: Record<string, unknown>;
    write: ReturnType<typeof vi.fn>;
  }[],
  sockets: [] as FakeSocket[],
  /** Order of cleanup steps across the fakes. */
  events: [] as string[],
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = vi.fn();
    constructor(public options: Record<string, unknown>) {
      terms.push(this);
    }
    loadAddon() {
      return undefined;
    }
    open() {
      return undefined;
    }
    focus() {
      return undefined;
    }
    onData() {
      return { dispose: () => undefined };
    }
    onBinary() {
      return { dispose: () => undefined };
    }
    dispose() {
      const socket = sockets.at(-1);
      events.push(
        `dispose terminal (onmessage ${socket?.onmessage ? 'set' : 'cleared'})`,
      );
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      return undefined;
    }
  },
}));

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    sockets.push(this);
  }
  send() {
    return undefined;
  }
  close() {
    this.readyState = 3;
  }
}

const INVENTORY: TerminalInventory = {
  home: '/home/u',
  loginShell: '/bin/bash',
  ghostty: { installed: false, version: null, files: [] },
  terminals: [],
  shells: [],
  pty: { available: true },
};

function fakeApi(): ApiClient {
  const unused = () => Promise.reject(new Error('unused'));
  return {
    token: 'session-token',
    fetch: unused,
    request: unused,
    get: unused,
    health: () =>
      Promise.resolve({ app: 'term-dashboard', version: '0', pid: 1 }),
    settings: unused,
    updateSettings: unused,
    inventory: () => Promise.resolve(INVENTORY),
  } as unknown as ApiClient;
}

beforeAll(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  window.matchMedia ??= (() => ({ matches: false })) as never;
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  terms.length = 0;
  sockets.length = 0;
  events.length = 0;
});

async function mount() {
  const view = render(
    <ApiContext.Provider value={fakeApi()}>
      <ThemeProvider
        backend={{
          load: () => new Promise(() => undefined),
          save: () => Promise.resolve(),
        }}
        cache={null}
      >
        <ShellDataProvider>
          <TerminalPage />
        </ShellDataProvider>
      </ThemeProvider>
    </ApiContext.Provider>,
  );
  await screen.findByRole('region', { name: 'Terminal' });
  // The socket opens in an effect that can run after the region is shown.
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  return view;
}

describe('TerminalPage', () => {
  it('raises faint ANSI colours to 4.5:1', async () => {
    await mount();
    expect(terms[0].options.minimumContrastRatio).toBe(4.5);
    expect(sockets[0].protocols).toEqual([expect.any(String), 'session-token']);
    expect(sockets[0].url).toContain(API_PATHS.pty);
  });

  it('detaches the socket before disposing the terminal on unmount', async () => {
    const view = await mount();
    const socket = sockets[0];
    view.unmount();
    expect(events).toEqual(['dispose terminal (onmessage cleared)']);
    expect(socket.onmessage).toBeNull();
    expect(socket.onopen).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(socket.readyState).toBe(3);
  });

  it('Reconnect leaves the old socket unable to write', async () => {
    await mount();
    const old = sockets[0];
    act(() => {
      old.onmessage?.({
        data: JSON.stringify({ type: 'exit', code: 0, signal: null }),
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    expect(sockets).toHaveLength(2);
    expect(old.onmessage).toBeNull();
    expect(terms[1].write).not.toHaveBeenCalled();
  });
});
