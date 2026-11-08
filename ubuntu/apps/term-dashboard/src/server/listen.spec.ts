import { connect } from 'node:net';
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

describe('listen peer check', () => {
  let running: RunningServer | null = null;
  afterEach(async () => {
    await running?.close();
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
