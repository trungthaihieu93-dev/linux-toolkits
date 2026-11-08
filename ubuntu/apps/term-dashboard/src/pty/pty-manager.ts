import {
  PTY_LIMITS,
  type Availability,
  type PtyServerMessage,
} from '@linux-toolchain/term-config';
import { errorMessage } from '../errors';
import type { CommandRunner } from '../exec/command-runner';
import { findExecutable, type Env } from '../system/environment';
import { OutputFlow } from './output-flow';
import { MAX_COLS, MAX_ROWS, PtySession } from './pty-session';

/** The transport side of one terminal connection (a WebSocket). */
export interface PtySocket {
  send(data: string | Uint8Array): void;
  close(code: number, reason?: string): void;
  /**
   * Bytes queued on the socket but not yet sent. When present, terminal
   * output stops being read while the queue is above `OUTPUT_HIGH_WATER`.
   */
  bufferedAmount?(): number;
}

/** Input accepted from a socket before its terminal has started. */
export const MAX_PENDING_INPUT_BYTES = 1024 * 1024;

export interface PtyConnection {
  /** A text frame (JSON control message) or a binary frame (input). */
  message(data: string | ArrayBuffer | Uint8Array): void;
  /** The socket closed; ends the session. */
  closed(): void;
}

export interface PtyManagerDeps {
  runner: CommandRunner;
  env: Env;
  home: string;
  /** Shell for new sessions (settings, then the login shell). */
  shell: () => Promise<string>;
}

/** WebSocket close codes used by the terminal. */
export const WS_CLOSE = {
  normal: 1000,
  policy: 1008,
  tooBig: 1009,
  internal: 1011,
  tryAgain: 1013,
} as const;

const byteLength = (data: string | ArrayBuffer | Uint8Array) =>
  typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;

/** Parse a `resize` control message; null when malformed. */
export function parseResize(
  text: string,
): { cols: number; rows: number } | null {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const { type, cols, rows } = msg as Record<string, unknown>;
  const ok = (v: unknown, max: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;
  return type === 'resize' && ok(cols, MAX_COLS) && ok(rows, MAX_ROWS)
    ? { cols, rows }
    : null;
}

/** Owns every PTY session: limits, wiring to sockets, and shutdown. */
export class PtyManager {
  private readonly sessions = new Set<PtySession>();
  private readonly sockets = new Set<PtySocket>();
  private shuttingDown = false;
  /** Connections between the limit check and their session existing. */
  private starting = 0;

  constructor(private readonly deps: PtyManagerDeps) {}

  get count(): number {
    return this.sessions.size;
  }

  async availability(): Promise<Availability> {
    for (const bin of ['script', 'setpriv']) {
      if ((await findExecutable(bin, this.deps.env)) === null) {
        return {
          available: false,
          reason: `the Terminal page needs util-linux \`${bin}\`, which is not installed`,
        };
      }
    }
    return { available: true };
  }

  /**
   * Attach a socket. Never throws: failures are reported on the socket, which
   * is then closed (1011 for internal errors).
   */
  connect(socket: PtySocket): PtyConnection {
    const send = (msg: PtyServerMessage) => {
      try {
        socket.send(JSON.stringify(msg));
      } catch {
        // The socket closed underneath us.
      }
    };
    const fail = (code: number, message: string) => {
      send({ type: 'error', message });
      socket.close(code, message.slice(0, 120));
    };

    let session: PtySession | null = null;
    let flow: OutputFlow | null = null;
    let closed = false;
    const pending: (string | ArrayBuffer | Uint8Array)[] = [];
    let pendingBytes = 0;

    const handle = (data: string | ArrayBuffer | Uint8Array) => {
      if (!session) return;
      if (typeof data === 'string') {
        const size = parseResize(data);
        if (!size) {
          send({ type: 'error', message: 'unknown control message' });
          return;
        }
        session.resize(size.cols, size.rows).catch((error: unknown) => {
          send({ type: 'error', message: errorMessage(error) });
        });
        return;
      }
      session.write(data instanceof Uint8Array ? data : new Uint8Array(data));
    };

    const start = async () => {
      if (this.shuttingDown)
        return fail(WS_CLOSE.tryAgain, 'td is shutting down');
      if (this.sessions.size + this.starting >= PTY_LIMITS.maxSessions) {
        return fail(
          WS_CLOSE.tryAgain,
          `at most ${PTY_LIMITS.maxSessions} terminals can be open`,
        );
      }
      this.starting++;
      try {
        await spawnSession();
      } finally {
        this.starting--;
      }
      if (session) {
        const pid = await session.ready;
        send({ type: 'ready', pid, shell: session.shell });
      }
    };

    const spawnSession = async () => {
      const available = await this.availability();
      if (!available.available)
        return fail(WS_CLOSE.policy, available.reason ?? 'unavailable');
      const shell = await this.deps.shell();
      if ((await findExecutable(shell, this.deps.env)) === null) {
        return fail(WS_CLOSE.policy, `shell ${shell} is not executable`);
      }
      if (closed) return;
      // closeAll() may have run while the checks above were awaited.
      if (this.shuttingDown) {
        return fail(WS_CLOSE.tryAgain, 'td is shutting down');
      }
      this.sockets.add(socket);
      const buffered = socket.bufferedAmount?.bind(socket);
      if (buffered) {
        flow = new OutputFlow({
          buffered,
          pause: () => s.pause(),
          resume: () => s.resume(),
        });
      }
      const s: PtySession = new PtySession({
        shell,
        cwd: this.deps.home,
        env: this.deps.env,
        cols: 80,
        rows: 24,
        runner: this.deps.runner,
        onData: (d) => {
          try {
            socket.send(d);
          } catch {
            // Closed socket; the close handler ends the session.
            return;
          }
          flow?.sent();
        },
        onExit: (code, signal) => {
          flow?.dispose();
          this.sessions.delete(s);
          this.sockets.delete(socket);
          send({ type: 'exit', code, signal });
          socket.close(WS_CLOSE.normal, 'shell exited');
        },
      });
      session = s;
      this.sessions.add(s);
      for (const data of pending.splice(0)) handle(data);
    };

    start().catch((error: unknown) => {
      if (session) void session.close();
      fail(WS_CLOSE.internal, errorMessage(error));
    });

    return {
      message: (data) => {
        if (byteLength(data) > PTY_LIMITS.maxMessageBytes) {
          fail(WS_CLOSE.tooBig, 'message too large');
          if (session) void session.close();
          return;
        }
        if (session) return handle(data);
        if (closed) return;
        pendingBytes += byteLength(data);
        if (pendingBytes > MAX_PENDING_INPUT_BYTES) {
          closed = true;
          pending.length = 0;
          fail(WS_CLOSE.policy, 'too much input before the terminal started');
          return;
        }
        pending.push(data);
      },
      closed: () => {
        closed = true;
        flow?.dispose();
        this.sockets.delete(socket);
        if (session) {
          const s = session;
          void s.close().finally(() => this.sessions.delete(s));
        }
      },
    };
  }

  /** End every session and socket (td shutdown). */
  async closeAll(): Promise<void> {
    this.shuttingDown = true;
    const sessions = [...this.sessions];
    await Promise.all(sessions.map((s) => s.close()));
    for (const socket of this.sockets) {
      try {
        socket.close(WS_CLOSE.normal, 'td stopped');
      } catch {
        // Already closed.
      }
    }
    this.sockets.clear();
    this.sessions.clear();
  }
}
