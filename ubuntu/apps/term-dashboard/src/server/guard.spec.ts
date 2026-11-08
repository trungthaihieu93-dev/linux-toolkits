import { Hono } from 'hono';
import { bearer, createGuard, subprotocols, type AccessPolicy } from './guard';
import { createSessionStore } from './session';

function setup(policy: AccessPolicy = { port: () => 4777 }) {
  const session = createSessionStore();
  const token = session.redeemLaunchCode(session.mintLaunchCode()) as string;
  const app = new Hono();
  app.use('*', createGuard(policy, session));
  app.all('*', (c) => c.text('ok'));
  return { app, session, token };
}

describe('createGuard', () => {
  it('rejects a foreign Host', async () => {
    const { app } = setup();
    for (const host of [
      'evil.example',
      'evil.example:4777',
      '127.0.0.1:9999',
      '',
    ]) {
      const res = await app.request('/api/health', { headers: { host } });
      expect(res.status).toBe(403);
    }
  });

  it('accepts 127.0.0.1 and localhost on the bound port', async () => {
    const { app } = setup();
    for (const host of ['127.0.0.1:4777', 'localhost:4777']) {
      expect(
        (await app.request('/api/health', { headers: { host } })).status,
      ).toBe(200);
    }
  });

  it('reads the port lazily', async () => {
    let port = 0;
    const { app } = setup({ port: () => port });
    port = 5123;
    expect(
      (
        await app.request('/api/health', {
          headers: { host: '127.0.0.1:5123' },
        })
      ).status,
    ).toBe(200);
  });

  it('accepts the dev origin host and origin', async () => {
    const { app, token } = setup({
      port: () => 4777,
      devOrigin: new URL('http://localhost:5173'),
    });
    const res = await app.request('/api/settings', {
      headers: {
        host: 'localhost:5173',
        origin: 'http://localhost:5173',
        authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it('requires the bearer token on private API routes', async () => {
    const { app, token } = setup();
    const host = '127.0.0.1:4777';
    expect(
      (await app.request('/api/settings', { headers: { host } })).status,
    ).toBe(401);
    expect(
      (
        await app.request('/api/settings', {
          headers: { host, authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request('/api/settings', {
          headers: { host, authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });

  it('keeps public routes public only for their method', async () => {
    const { app } = setup();
    const host = '127.0.0.1:4777';
    expect(
      (await app.request('/api/session', { method: 'POST', headers: { host } }))
        .status,
    ).toBe(200);
    expect(
      (await app.request('/api/session', { headers: { host } })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/health', { method: 'POST', headers: { host } }))
        .status,
    ).toBe(401);
  });

  it('rejects a cross-origin API call even with a token', async () => {
    const { app, token } = setup();
    const res = await app.request('/api/settings', {
      headers: {
        host: '127.0.0.1:4777',
        origin: 'http://evil.example',
        authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(403);
  });

  it('checks Origin and the token subprotocol on WebSocket upgrades', async () => {
    const { app, token } = setup();
    const base = { host: '127.0.0.1:4777', upgrade: 'websocket' };
    const ws = (headers: Record<string, string>) =>
      app.request('/ws/pty', { headers: { ...base, ...headers } });

    expect((await ws({ 'sec-websocket-protocol': token })).status).toBe(403);
    expect(
      (
        await ws({
          origin: 'http://evil.example',
          'sec-websocket-protocol': token,
        })
      ).status,
    ).toBe(403);
    expect((await ws({ origin: 'http://127.0.0.1:4777' })).status).toBe(401);
    expect(
      (
        await ws({
          origin: 'http://127.0.0.1:4777',
          'sec-websocket-protocol': `td, ${token}`,
        })
      ).status,
    ).toBe(200);
  });
});

describe('bearer', () => {
  it('extracts a well-formed credential only', () => {
    expect(bearer('Bearer abc_DEF-123')).toBe('abc_DEF-123');
    expect(bearer('bearer abc')).toBeNull();
    expect(bearer('Bearer a b')).toBeNull();
    expect(bearer(undefined)).toBeNull();
  });
});

describe('subprotocols', () => {
  it('splits and trims the header', () => {
    expect(subprotocols(' td , tok ,')).toEqual(['td', 'tok']);
    expect(subprotocols(undefined)).toEqual([]);
  });
});
