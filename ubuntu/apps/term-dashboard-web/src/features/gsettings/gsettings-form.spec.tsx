// @vitest-environment jsdom
import type {
  GSettingsKeyView,
  GSettingsSchemaView,
} from '@linux-toolchain/term-config';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { ToastProvider } from '../../components/ui/toast';
import { ApiContext, type ApiClient } from '../../lib/api';
import { GSETTINGS_WRITE_DELAY_MS, GSettingsForm } from './gsettings-form';

const PATH = '/api/terminals/ptyxis/global';

const key = (over: Partial<GSettingsKeyView>): GSettingsKeyView => ({
  name: 'k',
  type: 's',
  summary: '',
  description: '',
  value: "''",
  default: "''",
  isDefault: true,
  ...over,
});

function schema(values: Record<string, string>): GSettingsSchemaView {
  return {
    schema: 'org.gnome.Ptyxis',
    path: null,
    keys: Object.entries(values).map(([name, value]) =>
      name === 'size'
        ? key({ name, type: 'i', value, default: '10', isDefault: false })
        : key({ name, value, isDefault: value === "''" }),
    ),
  };
}

interface Call {
  method: string;
  body: unknown;
  resolve: (view: GSettingsSchemaView) => void;
}

/** An API whose writes stay pending until the test resolves them. */
function fakeApi(initial: GSettingsSchemaView) {
  const calls: Call[] = [];
  const request = ((method: string, path: string, body?: unknown) => {
    if (method === 'GET' && path === PATH) return Promise.resolve(initial);
    return new Promise<GSettingsSchemaView>((resolve) => {
      calls.push({ method, body, resolve });
    });
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

async function mount(initial: GSettingsSchemaView) {
  const fake = fakeApi(initial);
  render(
    <ToastProvider>
      <ApiContext.Provider value={fake.api}>
        <GSettingsForm path={PATH} label="Ptyxis settings" />
      </ApiContext.Provider>
    </ToastProvider>,
  );
  await act(async () => undefined);
  return fake;
}

const box = (name: string) =>
  screen.getByRole('textbox', { name }) as HTMLInputElement;
const type = (name: string, value: string) =>
  fireEvent.change(box(name), { target: { value } });
const pause = () =>
  act(async () => {
    vi.advanceTimersByTime(GSETTINGS_WRITE_DELAY_MS);
  });
const settle = () => act(async () => undefined);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GSettingsForm write ordering', () => {
  it('sends the next write only after the previous response arrived', async () => {
    const { calls } = await mount(schema({ a: "'a0'", b: "'b0'" }));

    type('a', 'a1');
    await pause();
    type('b', 'b1');
    await pause();
    expect(calls.map((c) => c.body)).toEqual([{ key: 'a', value: "'a1'" }]);

    calls[0].resolve(schema({ a: "'a1'", b: "'b0'" }));
    await settle();
    expect(calls.map((c) => c.body)).toEqual([
      { key: 'a', value: "'a1'" },
      { key: 'b', value: "'b1'" },
    ]);

    calls[1].resolve(schema({ a: "'a1'", b: "'b1'" }));
    await settle();
    expect(box('a').value).toBe('a1');
    expect(box('b').value).toBe('b1');
  });

  it('keeps a reset behind a running write', async () => {
    const { calls } = await mount(schema({ a: "'a0'", b: "'custom'" }));

    type('a', 'a1');
    await pause();
    fireEvent.click(screen.getByRole('button', { name: 'Reset b to default' }));
    await settle();
    expect(calls.map((c) => c.method)).toEqual(['PUT']);

    calls[0].resolve(schema({ a: "'a1'", b: "'custom'" }));
    await settle();
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ['PUT', { key: 'a', value: "'a1'" }],
      ['POST', { key: 'b' }],
    ]);
    calls[1].resolve(schema({ a: "'a1'", b: "''" }));
    await settle();
    expect(box('a').value).toBe('a1');
    expect(box('b').value).toBe('');
  });
});
