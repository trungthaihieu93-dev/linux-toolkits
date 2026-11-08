import type { ActivityEvent } from '@linux-toolchain/term-config';
import { ActivityStore, connectActivity, quoteArgv } from './activity';

const started = (id: string, argv = ['echo', id]): ActivityEvent => ({
  type: 'started',
  id,
  ts: 1,
  argv,
});

describe('ActivityStore', () => {
  it('folds started/output/exited into one command', () => {
    const store = new ActivityStore();
    store.apply(started('a', ['bash', '-n', '/tmp/x']));
    store.apply({
      type: 'output',
      id: 'a',
      ts: 2,
      stream: 'stderr',
      chunk: 'boom\n',
    });
    store.apply({
      type: 'exited',
      id: 'a',
      ts: 3,
      code: 2,
      signal: null,
      durationMs: 12,
    });
    const [cmd] = store.getSnapshot();
    expect(cmd).toMatchObject({
      argv: ['bash', '-n', '/tmp/x'],
      status: 'failed',
      code: 2,
      durationMs: 12,
      output: [{ stream: 'stderr', text: 'boom\n' }],
    });
  });

  it('drops the oldest commands past the command and byte caps', () => {
    const store = new ActivityStore({ maxCommands: 2, maxBytes: 100 });
    for (const id of ['a', 'b', 'c']) store.apply(started(id), 10);
    expect(store.getSnapshot().map((c) => c.id)).toEqual(['b', 'c']);
    store.apply(
      { type: 'output', id: 'c', ts: 2, stream: 'stdout', chunk: 'x' },
      85,
    );
    expect(store.getSnapshot().map((c) => c.id)).toEqual(['c']);
    expect(store.bytes).toBe(95);
  });

  it('ignores output whose command was evicted', () => {
    const store = new ActivityStore();
    store.apply({
      type: 'output',
      id: 'gone',
      ts: 1,
      stream: 'stdout',
      chunk: 'x',
    });
    expect(store.getSnapshot()).toEqual([]);
  });
});

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('connectActivity', () => {
  it('streams events with the authorized fetch and reconnects', async () => {
    const store = new ActivityStore();
    const statuses: string[] = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([`data: ${JSON.stringify(started('a'))}\n\n`, ': hb\n\n']),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const stop = connectActivity({
      fetch: fetchFn,
      store,
      onStatus: (s) => statuses.push(s),
      backoffMs: () => 0,
    });
    await vi.waitFor(() => expect(statuses).toContain('unauthorized'));
    stop();
    expect(fetchFn).toHaveBeenCalledWith('/api/activity', expect.anything());
    expect(statuses).toEqual([
      'connecting',
      'live',
      'reconnecting',
      'unauthorized',
    ]);
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('reports a server without the activity route', async () => {
    const statuses: string[] = [];
    connectActivity({
      fetch: async () => new Response(null, { status: 404 }),
      store: new ActivityStore(),
      onStatus: (s) => statuses.push(s),
    });
    await vi.waitFor(() => expect(statuses).toContain('unavailable'));
  });
});

describe('quoteArgv', () => {
  it('quotes only what needs quoting', () => {
    expect(quoteArgv(['gsettings', 'set', 'a.b', 'k', "'x y'"])).toBe(
      `gsettings set a.b k ''\\''x y'\\'''`,
    );
    expect(quoteArgv(['echo', ''])).toBe(`echo ''`);
  });
});
