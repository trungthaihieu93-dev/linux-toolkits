import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BODY_LIMITS, createApp } from './app';
import { createSessionStore, LAUNCH_CODE_TTL_MS } from './session';

const PORT = 4777;
const HOST = `127.0.0.1:${PORT}`;

function setup(webRoot: string | null = null, now = () => 1_000) {
  const session = createSessionStore({ now });
  const app = createApp({
    session,
    policy: { port: () => PORT },
    version: '9.9.9',
    pid: 4242,
    webRoot,
    fileContentRoutes: [/^\/api\/files\//],
  });
  const request = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { host: HOST, ...(init.headers as Record<string, string>) },
    });
  return { app, session, request };
}

const postJson = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('createApp', () => {
  it('serves health without a token and without secrets', async () => {
    const { request } = setup();
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      app: 'term-dashboard',
      version: '9.9.9',
      pid: 4242,
    });
  });

  it('rejects API calls without the session token', async () => {
    const { request } = setup();
    expect((await request('/api/settings')).status).toBe(401);
  });

  it('answers 404 for unknown API routes once authorised', async () => {
    const { request, session } = setup();
    const token = session.redeemLaunchCode(session.mintLaunchCode());
    const res = await request('/api/settings', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('swaps a launch code for the token exactly once', async () => {
    const { request, session } = setup();
    const code = session.mintLaunchCode();
    const first = await request('/api/session', postJson({ code }));
    expect(first.status).toBe(200);
    const { token } = (await first.json()) as { token: string };
    expect(session.isSessionToken(token)).toBe(true);

    const again = await request('/api/session', postJson({ code }));
    expect(again.status).toBe(401);
  });

  it('rejects an expired launch code', async () => {
    let t = 0;
    const { request, session } = setup(null, () => t);
    const code = session.mintLaunchCode();
    t = LAUNCH_CODE_TTL_MS;
    expect((await request('/api/session', postJson({ code }))).status).toBe(
      401,
    );
  });

  it('rejects malformed session requests', async () => {
    const { request } = setup();
    expect((await request('/api/session', postJson('not json'))).status).toBe(
      400,
    );
    expect((await request('/api/session', postJson({ code: 42 }))).status).toBe(
      400,
    );
  });

  it('mints launch codes only for the instance secret', async () => {
    const { request, session } = setup();
    const token = session.redeemLaunchCode(session.mintLaunchCode());
    const withToken = await request('/api/launch-code', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withToken.status).toBe(401);

    const res = await request('/api/launch-code', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.instanceSecret}` },
    });
    expect(res.status).toBe(200);
    const { code } = (await res.json()) as { code: string };
    expect(session.redeemLaunchCode(code)).toBe(token);
  });

  it('returns 413 for an oversized body', async () => {
    const { request } = setup();
    const big = JSON.stringify({ code: 'x'.repeat(BODY_LIMITS.default + 1) });
    const res = await request('/api/session', postJson(big));
    expect(res.status).toBe(413);
  });

  it('allows file-content routes up to the larger limit', async () => {
    const { request, session } = setup();
    const token = session.redeemLaunchCode(session.mintLaunchCode());
    const auth = { authorization: `Bearer ${token}` };
    const medium = 'x'.repeat(BODY_LIMITS.default * 4);
    // Passes the limit and reaches the (not yet existing) route: 404.
    expect(
      (await request('/api/files/zshrc', postJson(medium, auth))).status,
    ).toBe(404);
    const huge = 'x'.repeat(BODY_LIMITS.fileContent + 1);
    expect(
      (await request('/api/files/zshrc', postJson(huge, auth))).status,
    ).toBe(413);
  });

  describe('static web UI', () => {
    let parent: string;
    let root: string;
    beforeAll(async () => {
      parent = await mkdtemp(join(tmpdir(), 'td-web-'));
      root = join(parent, 'web');
      await mkdir(join(root, 'assets'), { recursive: true });
      await writeFile(join(parent, 'secret.txt'), 'secret');
      await writeFile(
        join(root, 'index.html'),
        '<!doctype html><title>td</title>',
      );
      await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
    });
    afterAll(() => rm(parent, { recursive: true, force: true }));

    it('serves files with their content type', async () => {
      const { request } = setup(root);
      const res = await request('/assets/app.js');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(
        'text/javascript; charset=utf-8',
      );
      expect(await res.text()).toBe('console.log(1)');
    });

    it('falls back to index.html for client routes', async () => {
      const { request } = setup(root);
      for (const path of ['/', '/ghostty', '/shells/zsh']) {
        const res = await request(path);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(await res.text()).toContain('<title>td</title>');
      }
    });

    it('returns 404 for missing assets and traversal attempts', async () => {
      const { request } = setup(root);
      expect((await request('/assets/missing.js')).status).toBe(404);
      for (const path of [
        '/%2e%2e/secret.txt',
        '/..%2fsecret.txt',
        '/assets/..%2f..%2fsecret.txt',
      ]) {
        const res = await request(path);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain('secret');
      }
    });

    it('still guards static requests by Host', async () => {
      const { app } = setup(root);
      const res = await app.request('/', {
        headers: { host: 'evil.example:4777' },
      });
      expect(res.status).toBe(403);
    });

    it('reports a missing build with 503', async () => {
      const { request } = setup(join(root, 'nope'));
      expect((await request('/')).status).toBe(503);
    });
  });
});
