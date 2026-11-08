import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { ActivityStream } from '@linux-toolchain/term-config';
import type { ActivityBus } from './activity-bus';

export interface RunOptions {
  cwd?: string;
  /** Variables merged over the runner's base environment. */
  env?: Readonly<Record<string, string>>;
  /** Written to stdin, which is then closed. */
  input?: string;
  /** Kill the command (SIGKILL) after this many milliseconds. */
  timeoutMs?: number;
}

export interface CommandResult {
  /** Exit code; null when killed by a signal or the spawn failed. */
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Spawn, timeout or output-limit error. */
  error?: string;
  /** The binary was not found (ENOENT). */
  notFound?: boolean;
}

/**
 * Runs external commands from an argv array. There is no shell: argv[0] is
 * looked up on PATH and every other element reaches the program verbatim.
 */
export interface CommandRunner {
  run(argv: readonly string[], opts?: RunOptions): Promise<CommandResult>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Output kept for the caller; activity output has its own, smaller cap. */
export const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

export const succeeded = (r: CommandResult) => r.code === 0 && !r.error;

/** One-line description of a failed command for error messages. */
export function failureText(argv: readonly string[], r: CommandResult): string {
  const why =
    r.error ??
    (r.signal ? `killed by ${r.signal}` : `exit code ${String(r.code)}`);
  const out = (r.stderr.trim() || r.stdout.trim()).slice(0, 2000);
  return `${argv.join(' ')}: ${why}${out ? `\n${out}` : ''}`;
}

export class ProcessCommandRunner implements CommandRunner {
  constructor(
    private readonly bus: ActivityBus,
    private readonly baseEnv: Readonly<
      Record<string, string | undefined>
    > = process.env,
  ) {}

  run(argv: readonly string[], opts: RunOptions = {}): Promise<CommandResult> {
    if (argv.length === 0 || argv[0] === '') {
      return Promise.reject(new Error('empty argv'));
    }
    const id = randomUUID();
    const started = Date.now();
    this.bus.publish({
      type: 'started',
      id,
      ts: started,
      argv: [...argv],
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });

    return new Promise<CommandResult>((resolve) => {
      const out = { stdout: [] as string[], stderr: [] as string[] };
      const decoders = {
        stdout: new StringDecoder('utf8'),
        stderr: new StringDecoder('utf8'),
      };
      let captured = 0;
      let error: string | undefined;
      let notFound = false;
      let settled = false;

      const child = spawn(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        env: { ...this.baseEnv, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        error = `timed out after ${timeout} ms`;
        child.kill('SIGKILL');
      }, timeout);

      const onData = (stream: ActivityStream) => (data: Buffer) => {
        const chunk = decoders[stream].write(data);
        captured += data.length;
        if (captured > MAX_CAPTURE_BYTES) {
          if (!error) error = `output exceeded ${MAX_CAPTURE_BYTES} bytes`;
          child.kill('SIGKILL');
          return;
        }
        if (chunk === '') return;
        out[stream].push(chunk);
        this.bus.publish({ type: 'output', id, ts: Date.now(), stream, chunk });
      };
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));

      const finish = (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const stream of ['stdout', 'stderr'] as const) {
          const rest = decoders[stream].end();
          if (rest) {
            out[stream].push(rest);
            this.bus.publish({
              type: 'output',
              id,
              ts: Date.now(),
              stream,
              chunk: rest,
            });
          }
        }
        const durationMs = Date.now() - started;
        this.bus.publish({
          type: 'exited',
          id,
          ts: Date.now(),
          code,
          signal,
          durationMs,
          ...(error ? { error } : {}),
        });
        resolve({
          code,
          signal,
          stdout: out.stdout.join(''),
          stderr: out.stderr.join(''),
          durationMs,
          ...(error ? { error } : {}),
          ...(notFound ? { notFound } : {}),
        });
      };

      child.on('error', (err: NodeJS.ErrnoException) => {
        notFound = err.code === 'ENOENT';
        error = notFound ? `${argv[0]}: command not found` : err.message;
        // 'close' does not follow a failed spawn.
        if (child.pid === undefined) finish(null, null);
      });
      child.on('close', (code, signal) => finish(code, signal));

      child.stdin.on('error', () => {
        // EPIPE when the command exits without reading its input.
      });
      child.stdin.end(opts.input ?? '');
    });
  }
}

export interface RecordedCommand {
  argv: string[];
  opts: RunOptions;
}

export type CommandResponder = (
  argv: readonly string[],
  opts: RunOptions,
) => Partial<CommandResult> | undefined;

/**
 * Test double: records every call and answers from `responder` (exit code 0
 * with empty output when it returns undefined). Mirrors `RecordingRunner` in
 * libs/core.
 */
export class RecordingCommandRunner implements CommandRunner {
  readonly calls: RecordedCommand[] = [];

  constructor(private responder: CommandResponder = () => undefined) {}

  respond(responder: CommandResponder): void {
    this.responder = responder;
  }

  async run(
    argv: readonly string[],
    opts: RunOptions = {},
  ): Promise<CommandResult> {
    this.calls.push({ argv: [...argv], opts });
    const answer = this.responder(argv, opts) ?? {};
    return {
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      ...answer,
    };
  }

  /** argv of every call, joined with spaces. */
  commands(): string[] {
    return this.calls.map((c) => c.argv.join(' '));
  }
}
