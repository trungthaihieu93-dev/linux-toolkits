import type { PtyServerMessage } from '@linux-toolchain/term-config';
import { createActivityBus } from '../exec/activity-bus';
import { ProcessCommandRunner } from '../exec/command-runner';
import {
  createSandbox,
  haveBinaries,
  pgrepSession,
  until,
  type Sandbox,
} from '../testing/sandbox';
import {
  parseResize,
  PtyManager,
  WS_CLOSE,
  type PtySocket,
} from './pty-manager';

const ready = await haveBinaries('script', 'setpriv', 'stty', 'pgrep');

describe('parseResize', () => {
  it('accepts integer sizes within bounds only', () => {
    expect(parseResize('{"type":"resize","cols":80,"rows":24}')).toEqual({
      cols: 80,
      rows: 24,
    });
    for (const bad of [
      'nope',
      '{"type":"resize","cols":0,"rows":24}',
      '{"type":"resize","cols":80.5,"rows":24}',
      '{"type":"resize","cols":80,"rows":100000}',
      '{"type":"other","cols":80,"rows":24}',
      'null',
    ]) {
      expect(parseResize(bad)).toBeNull();
    }
  });
});

class FakeSocket implements PtySocket {
  messages: PtyServerMessage[] = [];
  closed: number | null = null;
  send(data: string | Uint8Array) {
    if (typeof data === 'string')
      this.messages.push(JSON.parse(data) as PtyServerMessage);
  }
  close(code: number) {
    this.closed ??= code;
  }
  pid(): number | null {
    const m = this.messages.find((x) => x.type === 'ready');
    return m?.type === 'ready' ? m.pid : null;
  }
}

describe.skipIf(!ready)('PtyManager', () => {
  let sbx: Sandbox;
  let manager: PtyManager;

  beforeEach(async () => {
    sbx = await createSandbox('td-ptym-');
    manager = new PtyManager({
      runner: new ProcessCommandRunner(createActivityBus(), sbx.env),
      env: sbx.env,
      home: sbx.home,
      shell: async () => '/bin/sh',
    });
  });
  afterEach(async () => {
    await manager.closeAll();
    await sbx.cleanup();
  });

  it('allows at most 4 sessions and ends them all on closeAll', async () => {
    const sockets = Array.from({ length: 5 }, () => new FakeSocket());
    for (const s of sockets) manager.connect(s);
    await until(
      () => sockets.slice(0, 4).every((s) => s.pid() !== null),
      8000,
      'four ready',
    );
    await until(() => sockets[4].closed !== null, 2000, 'fifth refused');
    expect(sockets[4].closed).toBe(WS_CLOSE.tryAgain);
    expect(sockets[4].messages[0]).toMatchObject({ type: 'error' });
    expect(manager.count).toBe(4);
    const sids = sockets.slice(0, 4).map((s) => s.pid() as number);
    await manager.closeAll();
    for (const sid of sids) expect(pgrepSession(sid)).toBe(1);
    expect(manager.count).toBe(0);
  });

  it('closes with 1009 on an oversized message and refuses a non-executable shell', async () => {
    const big = new FakeSocket();
    const conn = manager.connect(big);
    await until(() => big.pid() !== null, 8000, 'ready');
    conn.message(new Uint8Array(64 * 1024 + 1));
    expect(big.closed).toBe(WS_CLOSE.tooBig);
    await until(
      () => pgrepSession(big.pid() as number) === 1,
      4000,
      'session gone',
    );

    const bad = new PtyManager({
      runner: new ProcessCommandRunner(createActivityBus(), sbx.env),
      env: sbx.env,
      home: sbx.home,
      shell: async () => '/nonexistent/shell',
    });
    const socket = new FakeSocket();
    bad.connect(socket);
    await until(() => socket.closed !== null, 2000, 'refused');
    expect(socket.closed).toBe(WS_CLOSE.policy);
  });
});
