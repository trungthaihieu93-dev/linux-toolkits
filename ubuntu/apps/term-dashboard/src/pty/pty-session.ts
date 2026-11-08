import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  failureText,
  succeeded,
  type CommandRunner,
} from '../exec/command-runner';
import type { Env } from '../system/environment';
import { childPids, sessionPids, signalSession, ttyOf } from './process-tree';

/**
 * `script` runs this with `$SHELL -c`; the shell path travels in the
 * environment and is never interpolated into the command.
 */
export const SCRIPT_COMMAND = 'exec "$TD_SHELL" -il';

export function ptyArgv(): string[] {
  return [
    'setpriv',
    '--pdeathsig',
    'HUP',
    '--',
    'script',
    '-qfec',
    SCRIPT_COMMAND,
    '/dev/null',
  ];
}

export const KILL_GRACE_MS = 2000;
const READY_TIMEOUT_MS = 5000;
const POLL_MS = 20;

export const MAX_COLS = 1000;
export const MAX_ROWS = 1000;

export interface PtySessionOptions {
  shell: string;
  cwd: string;
  env: Env;
  cols: number;
  rows: number;
  runner: CommandRunner;
  onData: (data: Buffer) => void;
  onExit: (code: number | null, signal: string | null) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * An interactive login shell on a real pty, without a native module:
 * `setpriv --pdeathsig HUP -- script -qfec 'exec "$TD_SHELL" -il' /dev/null`.
 *
 * - `detached` puts `script` in its own session; `script` gives the shell a
 *   second session whose id is the shell's pid.
 * - `--pdeathsig HUP` signals `script` if td dies without running cleanups.
 * - Resize runs `stty -F <shell tty> cols C rows R`; the kernel then sends
 *   SIGWINCH to the foreground job.
 * - `close()` sends SIGHUP to every process of both sessions (background jobs
 *   included) and SIGKILL to whatever is left after `KILL_GRACE_MS`.
 */
export class PtySession {
  private readonly child: ChildProcessWithoutNullStreams;
  private shellPid: number | null = null;
  private tty: string | null = null;
  private size: { cols: number; rows: number };
  private resizing: Promise<void> = Promise.resolve();
  private closing: Promise<void> | null = null;
  private exitedFlag = false;
  private readonly exitPromise: Promise<void>;
  /** Resolves with the shell pid once its tty is known. */
  readonly ready: Promise<number>;

  constructor(private readonly opts: PtySessionOptions) {
    this.size = { cols: opts.cols, rows: opts.rows };
    const [cmd, ...args] = ptyArgv();
    this.child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: {
        ...opts.env,
        TD_SHELL: opts.shell,
        // `script -c` runs the command with $SHELL; the shell keeps it.
        SHELL: opts.shell,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
      detached: true,
      stdio: 'pipe',
    });
    this.child.stdout.on('data', (d: Buffer) => opts.onData(d));
    this.child.stderr.on('data', (d: Buffer) => opts.onData(d));
    this.child.stdin.on('error', () => {
      // EPIPE after the shell exited.
    });
    this.exitPromise = new Promise((resolve) => {
      let reported = false;
      const report = (code: number | null, signal: string | null) => {
        this.exitedFlag = true;
        if (!reported) {
          reported = true;
          resolve();
          // Background jobs may outlive the shell; end them too.
          void this.close().finally(() => opts.onExit(code, signal));
        }
      };
      this.child.on('exit', (code, signal) => report(code, signal));
      this.child.on('error', (error) => {
        opts.onData(
          Buffer.from(
            `\r\ntd: could not start the terminal: ${error.message}\r\n`,
          ),
        );
        report(null, null);
      });
    });
    this.ready = this.findShell();
    // Callers that never await `ready` must not see an unhandled rejection.
    this.ready.catch(() => undefined);
  }

  get shell(): string {
    return this.opts.shell;
  }

  /** Pid of `script` (the session leader of the outer session). */
  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Session id of the shell (= the shell's pid), once known. */
  get sid(): number | null {
    return this.shellPid;
  }

  get exited(): boolean {
    return this.exitedFlag;
  }

  private async findShell(): Promise<number> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline && !this.exitedFlag && this.closing === null) {
      const pid = this.child.pid;
      if (pid !== undefined) {
        for (const child of await childPids(pid)) {
          const tty = await ttyOf(child);
          if (tty) {
            this.shellPid = child;
            this.tty = tty;
            await this.applySize();
            return child;
          }
        }
      }
      await sleep(POLL_MS);
    }
    throw new Error('the terminal shell did not start');
  }

  write(data: Uint8Array | string): void {
    if (!this.exitedFlag && this.child.stdin.writable)
      this.child.stdin.write(data);
  }

  /** Apply a new size; calls are serialised and only the latest size is applied. */
  resize(cols: number, rows: number): Promise<void> {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 1 ||
      rows < 1 ||
      cols > MAX_COLS ||
      rows > MAX_ROWS
    ) {
      return Promise.reject(new Error('invalid terminal size'));
    }
    this.size = { cols, rows };
    if (this.tty === null) return Promise.resolve(); // applied once ready
    this.resizing = this.resizing.then(() => this.applySize());
    return this.resizing;
  }

  private applied: { cols: number; rows: number } | null = null;

  private async applySize(): Promise<void> {
    const { cols, rows } = this.size;
    if (this.tty === null || this.exitedFlag) return;
    if (
      this.applied &&
      this.applied.cols === cols &&
      this.applied.rows === rows
    )
      return;
    const argv = [
      'stty',
      '-F',
      this.tty,
      'cols',
      String(cols),
      'rows',
      String(rows),
    ];
    const r = await this.opts.runner.run(argv, { timeoutMs: 5000 });
    if (!succeeded(r)) {
      // The tty disappears when the shell exits mid-resize; nothing to fix.
      if (!this.exitedFlag) throw new Error(failureText(argv, r));
      return;
    }
    this.applied = { cols, rows };
  }

  /** End the shell and everything it started. Idempotent. */
  close(): Promise<void> {
    this.closing ??= this.terminate();
    return this.closing;
  }

  private async terminate(): Promise<void> {
    const sessions = [this.shellPid, this.child.pid].filter(
      (s): s is number => typeof s === 'number',
    );
    for (const sid of sessions) await signalSession(sid, 'SIGHUP');
    const deadline = Date.now() + KILL_GRACE_MS;
    while (Date.now() < deadline) {
      const left = (await Promise.all(sessions.map(sessionPids))).flat();
      if (left.length === 0) break;
      await sleep(50);
    }
    for (const sid of sessions) await signalSession(sid, 'SIGKILL');
    if (!this.exitedFlag) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
      await Promise.race([this.exitPromise, sleep(1000)]);
    }
  }
}
