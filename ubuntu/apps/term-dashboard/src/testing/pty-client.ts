import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { PtyServerMessage } from '@linux-toolchain/term-config';
import { until } from './sandbox';

/** Make td's Terminal page use /bin/sh in the sandbox (no zsh first-run menu). */
export async function useShInSandbox(configHome: string): Promise<void> {
  const dir = join(configHome, 'term-dashboard');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({ terminalShell: '/bin/sh' }),
  );
}

/** Swap a launch code for the session token. */
export async function exchangeCode(
  origin: string,
  code: string,
): Promise<string> {
  const res = await fetch(`${origin}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.status !== 200)
    throw new Error(`session exchange failed: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

export interface PtyClient {
  ws: WebSocket;
  output: () => string;
  messages: PtyServerMessage[];
  closeCode: () => number | null;
  ready: () => Promise<number>;
  send(text: string): void;
}

/** Open `/ws/pty` the way the dashboard does (Origin + `['td', token]`). */
export function openPty(
  port: number,
  token: string,
  origin = `http://127.0.0.1:${port}`,
): Promise<PtyClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/pty`, ['td', token], {
    origin,
  });
  let out = '';
  let code: number | null = null;
  const messages: PtyServerMessage[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) out += Buffer.from(data as Buffer).toString();
    else messages.push(JSON.parse(String(data)) as PtyServerMessage);
  });
  ws.on('close', (c) => {
    code = c;
  });
  return new Promise((resolve, reject) => {
    ws.once('open', () =>
      resolve({
        ws,
        output: () => out,
        messages,
        closeCode: () => code,
        ready: async () => {
          await until(
            () =>
              messages.some((m) => m.type === 'ready' || m.type === 'error'),
            8000,
            'pty ready',
          );
          const msg = messages.find(
            (m) => m.type === 'ready' || m.type === 'error',
          );
          if (msg?.type !== 'ready')
            throw new Error(`pty failed: ${JSON.stringify(msg)}`);
          return msg.pid;
        },
        send: (text) => ws.send(Buffer.from(text), { binary: true }),
      }),
    );
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`handshake rejected: ${res.statusCode}`));
    });
    ws.once('error', reject);
  });
}
