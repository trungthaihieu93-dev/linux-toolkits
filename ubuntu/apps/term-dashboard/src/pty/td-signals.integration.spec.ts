import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { findExecutable } from '../system/environment';
import { exchangeCode, openPty, useShInSandbox } from '../testing/pty-client';
import {
  createSandbox,
  haveBinaries,
  pgrepSession,
  until,
  type Sandbox,
} from '../testing/sandbox';

/**
 * Runs td itself as a child (from TypeScript source, under Bun) and stops it
 * with a signal while a terminal with a background job is open: the shell's
 * whole session must be gone afterwards (closing td's terminal = SIGHUP,
 * Ctrl-C = SIGINT).
 */
const bun = process.versions['bun']
  ? process.execPath
  : await findExecutable('bun', process.env);
const ready =
  bun !== null && (await haveBinaries('script', 'setpriv', 'stty', 'pgrep'));
const MAIN = join(import.meta.dirname, '..', 'main.ts');

describe.skipIf(!ready)('td stopped by a signal', () => {
  let sbx: Sandbox;
  let td: ChildProcess | null = null;

  beforeEach(async () => {
    sbx = await createSandbox('td-signal-');
    await useShInSandbox(sbx.env['XDG_CONFIG_HOME']);
  });
  afterEach(async () => {
    if (td && td.exitCode === null && td.signalCode === null)
      td.kill('SIGKILL');
    td = null;
    await sbx.cleanup();
  });

  it.each([
    ['SIGHUP', 129],
    ['SIGINT', 130],
  ] as const)(
    'kills the terminal session and its background jobs on %s',
    async (signal, code) => {
      const child = spawn(bun as string, [MAIN, '--no-open', '--port', '0'], {
        cwd: sbx.home,
        env: sbx.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      td = child;
      let out = '';
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString();
      });
      const exited = new Promise<number | null>((resolve) =>
        child.on('exit', (c) => resolve(c)),
      );
      await until(() => /#c=/.test(out), 15_000, 'td launch URL');
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/#c=([A-Za-z0-9_-]+)/.exec(
        out,
      ) as RegExpExecArray;
      const port = Number(m[1]);
      const token = await exchangeCode(`http://127.0.0.1:${port}`, m[2]);

      const client = await openPty(port, token);
      const sid = await client.ready();
      client.send('sleep 300 &\n');
      await until(() => pgrepSession(sid) === 0, 5000, 'background job');

      child.kill(signal);
      expect(await exited).toBe(code);
      await until(() => pgrepSession(sid) === 1, 4000, 'session gone');
      expect(pgrepSession(sid)).toBe(1);
    },
    30_000,
  );
});
