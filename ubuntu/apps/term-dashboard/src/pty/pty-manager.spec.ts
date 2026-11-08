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
import { OUTPUT_HIGH_WATER } from './output-flow';
import {
  parseResize,
  PtyManager,
  WS_CLOSE,
  type PtySocket,
} from './pty-manager';

const ready = await haveBinaries('script', 'setpriv', 'stty', 'pgrep');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
  /** Binary bytes handed to the socket, and how many the peer has read. */
  sentBytes = 0;
  readBytes = 0;
  send(data: string | Uint8Array) {
    if (typeof data === 'string')
      this.messages.push(JSON.parse(data) as PtyServerMessage);
    else this.sentBytes += data.byteLength;
  }
  bufferedAmount() {
    return this.sentBytes - this.readBytes;
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

  it('stops reading terminal output while the socket is backed up', async () => {
    const socket = new FakeSocket();
    const conn = manager.connect(socket);
    await until(() => socket.pid() !== null, 8000, 'ready');
    conn.message(new TextEncoder().encode('yes\n'));
    await until(
      () => socket.sentBytes > OUTPUT_HIGH_WATER,
      8000,
      'output past the high-water mark',
    );
    await sleep(300);
    const stalled = socket.sentBytes;
    await sleep(300);
    expect(socket.sentBytes).toBe(stalled);
    // One pipe read can land after the mark is crossed, never more.
    expect(stalled).toBeLessThan(OUTPUT_HIGH_WATER + 256 * 1024);

    socket.readBytes = socket.sentBytes;
    await until(
      () => socket.sentBytes > stalled + 64 * 1024,
      5000,
      'output resumes once the socket drains',
    );
  });

  it('closes a connection that sends too much before the terminal starts', async () => {
    const gate = deferred<string>();
    const slow = new PtyManager({
      runner: new ProcessCommandRunner(createActivityBus(), sbx.env),
      env: sbx.env,
      home: sbx.home,
      shell: () => gate.promise,
    });
    const socket = new FakeSocket();
    const conn = slow.connect(socket);
    for (let i = 0; i < 17 && socket.closed === null; i++) {
      conn.message(new Uint8Array(64 * 1024));
    }
    expect(socket.closed).toBe(WS_CLOSE.policy);
    gate.resolve('/bin/sh');
    await sleep(200);
    expect(slow.count).toBe(0);
    await slow.closeAll();
  });

  it('does not start a terminal for a connection that was starting during shutdown', async () => {
    const gate = deferred<string>();
    const slow = new PtyManager({
      runner: new ProcessCommandRunner(createActivityBus(), sbx.env),
      env: sbx.env,
      home: sbx.home,
      shell: () => gate.promise,
    });
    const socket = new FakeSocket();
    slow.connect(socket);
    await sleep(50);
    await slow.closeAll();
    gate.resolve('/bin/sh');
    await until(() => socket.closed !== null, 2000, 'refused');
    expect(socket.closed).toBe(WS_CLOSE.tryAgain);
    await sleep(200);
    expect(slow.count).toBe(0);
    expect(socket.pid()).toBeNull();
  });
});
