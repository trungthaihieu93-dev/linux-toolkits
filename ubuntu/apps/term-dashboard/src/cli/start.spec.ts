import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCleanupRegistry, type ShutdownSignal } from '../server/cleanup';
import { isProcessAlive, readInstanceFile } from '../server/instance';
import { startServer, type StartDeps, type StartOptions } from './start';

const uid = process.getuid?.() ?? 0;

function harness(dir: string, overrides: Partial<StartDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let emit: ((signal: ShutdownSignal) => void) | null = null;
  const openUrl = vi.fn();
  const forceExit = vi.fn();
  const deps: StartDeps = {
    out: { write: (s) => out.push(s) },
    err: { write: (s) => err.push(s) },
    uid: uid === 0 ? 1000 : uid,
    pid: process.pid,
    version: '1.2.3',
    instanceFile: join(dir, 'term-dashboard', 'instance.json'),
    webRoot: null,
    fetch: globalThis.fetch,
    isAlive: isProcessAlive,
    canOpenBrowser: true,
    openUrl,
    signals: (listener) => {
      emit = listener;
      return () => {
        emit = null;
      };
    },
    cleanups: createCleanupRegistry(),
    forceExit,
    ...overrides,
  };
  return {
    deps,
    out,
    err,
    openUrl,
    forceExit,
    signal: (s: ShutdownSignal) => {
      if (!emit) throw new Error('no signal listener');
      emit(s);
    },
  };
}

const opts: StartOptions = { port: 0, open: true };

/** Resolves once `pred` holds, polling every 10 ms. */
async function until(pred: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const launchUrl = (text: string) => {
  const match = /(http:\/\/127\.0\.0\.1:(\d+))\/#c=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error(`no launch URL in: ${text}`);
  return { origin: match[1], port: Number(match[2]), code: match[3] };
};

describe('startServer', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'td-start-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('refuses to start as root', async () => {
    const h = harness(dir, { uid: 0 });
    expect(await startServer(opts, h.deps)).toBe(1);
    expect(h.err.join('')).toContain('refusing to start the server as root');
  });

  it('serves, writes the instance file, is reused, and cleans up on a signal', async () => {
    const first = harness(dir);
    const exit = startServer(opts, first.deps);
    await until(() => first.out.join('').includes('#c='));

    const { origin, port, code } = launchUrl(first.out.join(''));
    // The browser gets a private file:// page; the code is never in argv.
    expect(first.openUrl).toHaveBeenCalledOnce();
    const opened = first.openUrl.mock.calls[0][0] as string;
    expect(opened).toMatch(/^file:\/\/.*\/launch-[0-9a-f]{32}\.html$/);
    expect(opened).not.toContain(code);
    const page = fileURLToPath(opened);
    expect(dirname(page)).toBe(dirname(first.deps.instanceFile));
    expect((await stat(page)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(page))).mode & 0o777).toBe(0o700);
    expect(await readFile(page, 'utf8')).toContain(`${origin}/#c=${code}`);
    const instance = await readInstanceFile(
      first.deps.instanceFile,
      first.deps.uid,
    );
    expect(instance).toMatchObject({ port, pid: process.pid });
    expect((await stat(first.deps.instanceFile)).mode & 0o777).toBe(0o600);

    const health = await fetch(`${origin}/api/health`);
    expect(await health.json()).toEqual({
      app: 'term-dashboard',
      version: '1.2.3',
      pid: process.pid,
    });
    expect((await fetch(`${origin}/api/settings`)).status).toBe(401);
    const session = await fetch(`${origin}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(session.status).toBe(200);
    const { token } = (await session.json()) as { token: string };
    await expect(stat(page)).rejects.toMatchObject({ code: 'ENOENT' });
    const notices = first.err.join('');
    expect(notices).toMatch(/launch link used/);
    expect(notices).not.toContain(code);
    expect(notices).not.toContain(token);

    // A second td reuses the first one and exits 0.
    const second = harness(dir);
    expect(await startServer(opts, second.deps)).toBe(0);
    expect(second.out.join('')).toContain(
      `td already running (pid ${process.pid})`,
    );
    const reused = launchUrl(second.out.join(''));
    expect(reused.port).toBe(port);
    expect(second.openUrl).toHaveBeenCalledOnce();
    const handover = second.openUrl.mock.calls[0][0] as string;
    expect(handover).toMatch(/^file:\/\/.*\/launch-[0-9a-f]{32}\.html$/);
    expect(handover).not.toContain(reused.code);
    expect(await readFile(fileURLToPath(handover), 'utf8')).toContain(
      `#c=${reused.code}`,
    );

    first.signal('SIGTERM');
    expect(await exit).toBe(143);
    expect(
      await readInstanceFile(first.deps.instanceFile, first.deps.uid),
    ).toBeNull();
    await expect(fetch(`${origin}/api/health`)).rejects.toThrow();
  });

  it('forces exit on a second signal during shutdown', async () => {
    const cleanups = createCleanupRegistry();
    let release: () => void = () => undefined;
    const h = harness(dir, { cleanups });
    const exit = startServer(opts, h.deps);
    await until(() => h.out.join('').includes('#c='));
    cleanups.register(() => new Promise<void>((r) => (release = r)));
    h.signal('SIGINT');
    h.signal('SIGINT');
    expect(h.forceExit).toHaveBeenCalledWith(130);
    release();
    expect(await exit).toBe(130);
  });

  it('does not open a browser with --no-open or without a display', async () => {
    for (const [open, canOpenBrowser] of [
      [false, true],
      [true, false],
    ] as const) {
      const h = harness(dir, { canOpenBrowser });
      const exit = startServer({ port: 0, open }, h.deps);
      await until(() => h.out.join('').includes('#c='));
      expect(h.openUrl).not.toHaveBeenCalled();
      h.signal('SIGINT');
      await exit;
    }
  });

  it('prints the launch URL on the dev origin', async () => {
    const h = harness(dir);
    const exit = startServer(
      { port: 0, open: false, devOrigin: new URL('http://localhost:5173') },
      h.deps,
    );
    await until(() => h.out.join('').includes('#c='));
    expect(h.out.join('')).toMatch(
      /Open: http:\/\/localhost:5173\/#c=[A-Za-z0-9_-]+/,
    );
    h.signal('SIGHUP');
    expect(await exit).toBe(129);
  });

  it('exits 1 naming the port when it is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as { port: number }).port;
    try {
      const h = harness(dir);
      expect(await startServer({ port, open: false }, h.deps)).toBe(1);
      expect(h.err.join('')).toContain(`port ${port} is in use`);
      expect(h.err.join('')).toContain('--port');
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });
});
