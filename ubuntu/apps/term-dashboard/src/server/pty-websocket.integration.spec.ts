import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer, type StartDeps } from '../cli/start';
import { createCleanupRegistry, type ShutdownSignal } from './cleanup';
import { isProcessAlive } from './instance';
import { createServices } from './services';
import { exchangeCode, openPty, useShInSandbox } from '../testing/pty-client';
import {
  createSandbox,
  haveBinaries,
  pgrepSession,
  until,
  type Sandbox,
} from '../testing/sandbox';

/**
 * A real WebSocket against the running app: Origin and token-subprotocol
 * checks happen in the HTTP upgrade, the server answers with `td` only, and
 * the PTY session dies with the socket.
 */
const ready = await haveBinaries('script', 'setpriv', 'stty', 'pgrep');

describe.skipIf(!ready)('PTY over a real WebSocket', () => {
  let sbx: Sandbox;
  let emit: ((s: ShutdownSignal) => void) | null;
  let done: Promise<number>;
  let port: number;
  let token: string;

  beforeEach(async () => {
    sbx = await createSandbox('td-ws-');
    await useShInSandbox(sbx.env['XDG_CONFIG_HOME']);
    const out: string[] = [];
    emit = null;
    const deps: StartDeps = {
      out: { write: (s) => out.push(s) },
      err: { write: () => undefined },
      uid: process.getuid?.() || 1000,
      pid: process.pid,
      version: '0.0.0-test',
      instanceFile: join(
        sbx.env['XDG_RUNTIME_DIR'],
        'term-dashboard',
        'instance.json',
      ),
      webRoot: null,
      fetch: globalThis.fetch,
      isAlive: isProcessAlive,
      canOpenBrowser: false,
      openUrl: () => undefined,
      signals: (listener) => {
        emit = listener;
        return () => {
          emit = null;
        };
      },
      cleanups: createCleanupRegistry(),
      forceExit: () => undefined,
      createServices: () => createServices({ env: sbx.env, home: sbx.home }),
    };
    done = startServer({ port: 0, open: false }, deps);
    await until(() => /#c=/.test(out.join('')), 5000, 'launch URL');
    const m = /http:\/\/127\.0\.0\.1:(\d+)\/#c=([A-Za-z0-9_-]+)/.exec(
      out.join(''),
    ) as RegExpExecArray;
    port = Number(m[1]);
    token = await exchangeCode(`http://127.0.0.1:${port}`, m[2]);
  });

  afterEach(async () => {
    emit?.('SIGTERM');
    await done;
    await sbx.cleanup();
  });

  it('rejects a foreign Origin and a missing token during the handshake', async () => {
    await expect(openPty(port, token, 'http://evil.example')).rejects.toThrow(
      'handshake rejected: 403',
    );
    await expect(openPty(port, 'not-the-token')).rejects.toThrow(
      'handshake rejected: 401',
    );
  });

  it('accepts the token subprotocol, answers with `td`, and kills the shell on close', async () => {
    const client = await openPty(port, token);
    expect(client.ws.protocol).toBe('td');
    const sid = await client.ready();
    client.ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    client.send('stty size; sleep 300 &\n');
    await until(() => client.output().includes('30 100'), 5000, 'resize');
    await until(() => pgrepSession(sid) === 0, 3000, 'job');
    client.ws.close();
    await until(() => pgrepSession(sid) === 1, 4000, 'session gone');
  });

  it('closes the socket with 1009 on a message over 64 KB', async () => {
    const client = await openPty(port, token);
    const sid = await client.ready();
    client.ws.send(Buffer.alloc(64 * 1024 + 1, 0x61), { binary: true });
    await until(() => client.closeCode() !== null, 4000, 'close');
    expect(client.closeCode()).toBe(1009);
    await until(() => pgrepSession(sid) === 1, 4000, 'session gone');
  });

  it('ends open terminals when td shuts down', async () => {
    const client = await openPty(port, token);
    const sid = await client.ready();
    client.send('sleep 300 &\n');
    await until(() => pgrepSession(sid) === 0, 3000, 'job');
    emit?.('SIGINT');
    expect(await done).toBe(130);
    await until(() => pgrepSession(sid) === 1, 4000, 'session gone');
    expect(client.ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
