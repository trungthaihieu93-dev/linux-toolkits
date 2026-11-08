import { connect, type Socket } from 'node:net';
import { listen, type RunningServer } from './listen';

const ownUid = process.getuid?.() ?? 0;

/** One raw HTTP/1.1 request; resolves with the response text ('' if dropped). */
function rawGet(port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.on('connect', () =>
      socket.write(
        `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      ),
    );
    socket.on('data', (d) => (data += d.toString()));
    socket.on('error', () => resolve(data));
    socket.on('close', () => resolve(data));
  });
}

/** Resolves with `promise`'s value, or 'timeout' after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/** A raw client socket, plus everything it receives and when it closes. */
function rawClient(port: number) {
  const socket: Socket = connect(port, '127.0.0.1');
  let data = '';
  socket.on('data', (d) => (data += d.toString()));
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) =>
    socket.on('close', () => resolve()),
  );
  const connected = new Promise<void>((resolve) =>
    socket.once('connect', () => resolve()),
  );
  return { socket, connected, closed, data: () => data };
}

const keepAliveGet = (port: number) =>
  `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`;

describe('listen peer check', () => {
  let running: RunningServer | null = null;
  afterEach(async () => {
    // Bounded, so a close() that hangs fails its own test, not the hook.
    if (running) await within(running.close(), 2000);
    running = null;
  });

  it('serves a connection from the same user, found in /proc/net/tcp', async () => {
    const handler = vi.fn(() => new Response('ok'));
    running = await listen(handler, 0, { peer: { uid: ownUid } });
    const res = await fetch(`http://127.0.0.1:${running.port}/api/health`);
    expect(await res.text()).toBe('ok');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('drops a connection from another uid before any request is read', async () => {
    const handler = vi.fn(() => new Response('ok'));
    const refused = vi.fn();
    const peerUid = vi.fn(async () => ownUid + 1);
    running = await listen(handler, 0, {
      peer: { uid: ownUid, peerUid, onRefused: refused },
    });
    expect(await rawGet(running.port)).toBe('');
    expect(handler).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledWith(ownUid + 1);
    const [client, server] = peerUid.mock.calls[0] as unknown as [
      { address: string; port: number },
      { address: string; port: number },
    ];
    expect(server).toEqual({ address: '127.0.0.1', port: running.port });
    expect(client.address).toBe('127.0.0.1');
    expect(client.port).toBeGreaterThan(0);
  });

  it('drops a connection whose owner cannot be found', async () => {
    const handler = vi.fn(() => new Response('ok'));
    running = await listen(handler, 0, {
      peer: { uid: ownUid, peerUid: async () => null },
    });
    expect(await rawGet(running.port)).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('listen shutdown', () => {
  let running: RunningServer | null = null;
  const clients: Socket[] = [];
  afterEach(async () => {
    for (const socket of clients.splice(0)) socket.destroy();
    if (running) await within(running.close(), 2000);
    running = null;
  });

  it('close() drops an idle keep-alive connection and resolves', async () => {
    running = await listen(() => new Response('ok'), 0, {
      peer: { uid: ownUid },
    });
    const client = rawClient(running.port);
    clients.push(client.socket);
    await client.connected;
    client.socket.write(keepAliveGet(running.port));
    await vi.waitFor(() => expect(client.data()).toContain('ok'));

    expect(await within(running.close(), 1000)).toBeUndefined();
    expect(await within(client.closed, 1000)).toBeUndefined();
  });

  it('close() ends a response that is still streaming', async () => {
    // Like the activity stream: headers sent, body never ends.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hi\n\n'));
      },
    });
    running = await listen(
      () =>
        new Response(body, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      0,
      { peer: { uid: ownUid } },
    );
    const client = rawClient(running.port);
    clients.push(client.socket);
    await client.connected;
    client.socket.write(keepAliveGet(running.port));
    await vi.waitFor(() => expect(client.data()).toContain('data: hi'));

    expect(await within(running.close(), 1000)).toBeUndefined();
    expect(await within(client.closed, 1000)).toBeUndefined();
  });

  it('drops a connection whose check completes after close()', async () => {
    const handler = vi.fn(() => new Response('ok'));
    let answer: (uid: number) => void = () => undefined;
    const peerUid = vi.fn(
      () => new Promise<number>((resolve) => (answer = resolve)),
    );
    running = await listen(handler, 0, { peer: { uid: ownUid, peerUid } });
    const client = rawClient(running.port);
    clients.push(client.socket);
    await client.connected;
    client.socket.write(keepAliveGet(running.port));
    await vi.waitFor(() => expect(peerUid).toHaveBeenCalledOnce());

    const closing = running.close();
    answer(ownUid);
    expect(await within(closing, 1000)).toBeUndefined();
    expect(await within(client.closed, 1000)).toBeUndefined();
    expect(client.data()).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  // Bun's node:http does not apply these timeouts to sockets passed in with
  // emit('connection'); Node, the runtime the bundle targets, does.
  it.skipIf(Boolean(process.versions['bun']))(
    'answers a request whose headers never finish with 408',
    async () => {
      const handler = vi.fn(() => new Response('ok'));
      running = await listen(handler, 0, {
        peer: { uid: ownUid },
        http: {
          headersTimeout: 200,
          requestTimeout: 200,
          connectionsCheckingInterval: 50,
        },
      });
      const client = rawClient(running.port);
      clients.push(client.socket);
      await client.connected;
      client.socket.write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\n`);

      expect(await within(client.closed, 2000)).toBeUndefined();
      expect(client.data()).toMatch(/^HTTP\/1\.1 408/);
      expect(handler).not.toHaveBeenCalled();
    },
  );
});
