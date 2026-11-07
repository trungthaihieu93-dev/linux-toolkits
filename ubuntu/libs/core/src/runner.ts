import { spawn as nodeSpawn } from 'node:child_process';
import { USER_ENV, type Context } from './context';

/** Executes shell scripts as root or as the target user. */
export interface Runner {
  /** Run `script` as root. Resolves on exit 0, rejects with StepError otherwise. */
  asRoot(script: string, label: string): Promise<void>;
  /** Run `script` as the target user in a login shell with USER_ENV loaded. */
  asUser(script: string, label: string): Promise<void>;
}

export class StepError extends Error {
  constructor(
    readonly label: string,
    readonly exitCode: number | null,
    options?: { cause?: unknown; signal?: string | null },
  ) {
    const why = options?.signal
      ? `killed by ${options.signal}`
      : exitCode === null
        ? `could not start${options?.cause instanceof Error ? `: ${options.cause.message}` : ''}`
        : `exit code ${exitCode}`;
    super(`step failed: ${label} (${why})`, { cause: options?.cause });
    this.name = 'StepError';
  }
}

/** Root scripts: same environment the bash script exported, fail fast. */
export function rootScript(script: string): string {
  return `export DEBIAN_FRONTEND=noninteractive; set -e; ${script}`;
}

/** User scripts: same wrapping as user_sh in install-toolchains.sh. */
export function userScript(script: string): string {
  return `cd "$HOME"; ${USER_ENV} set -e; ${script}`;
}

/** Minimal child-process surface ProcessRunner needs; node's spawn satisfies it. */
export interface SpawnedProcess {
  once(event: 'error', listener: (err: Error) => void): unknown;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit' | 'ignore' },
) => SpawnedProcess;

export interface ProcessRunnerOptions {
  spawn?: SpawnFn;
  /** Interval for refreshing the sudo timestamp in non-root mode. */
  sudoRefreshMs?: number;
}

/**
 * Runs scripts for real with inherited stdio. As a normal user, root steps go
 * through sudo (prompting on the TTY once); as root, user steps go through
 * runuser. The CLI never reads or stores a password.
 */
export class ProcessRunner implements Runner {
  private readonly spawn: SpawnFn;
  private readonly sudoRefreshMs: number;
  private sudoReady: Promise<void> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly ctx: Context,
    opts: ProcessRunnerOptions = {},
  ) {
    this.spawn = opts.spawn ?? ((cmd, args, o) => nodeSpawn(cmd, args, o));
    this.sudoRefreshMs = opts.sudoRefreshMs ?? 60_000;
  }

  async asRoot(script: string, label: string): Promise<void> {
    const wrapped = rootScript(script);
    if (this.ctx.isRoot) return this.exec('bash', ['-c', wrapped], label);
    await this.ensureSudo();
    return this.exec('sudo', ['bash', '-c', wrapped], label);
  }

  asUser(script: string, label: string): Promise<void> {
    const wrapped = userScript(script);
    if (!this.ctx.isRoot) return this.exec('bash', ['-lc', wrapped], label);
    const { user, home } = this.ctx;
    return this.exec(
      'runuser',
      [
        '-u',
        user,
        '--',
        'env',
        `HOME=${home}`,
        `USER=${user}`,
        `LOGNAME=${user}`,
        'bash',
        '-lc',
        wrapped,
      ],
      label,
    );
  }

  /** Stop the sudo refresh timer. Safe to call more than once. */
  close(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private ensureSudo(): Promise<void> {
    if (!this.sudoReady) {
      this.sudoReady = this.exec('sudo', ['-v'], 'sudo authentication').then(
        () => {
          this.refreshTimer = setInterval(
            () => this.refreshSudo(),
            this.sudoRefreshMs,
          );
          this.refreshTimer.unref();
        },
      );
      // A failed authentication may be retried on the next root step.
      this.sudoReady.catch(() => {
        this.sudoReady = undefined;
      });
    }
    return this.sudoReady;
  }

  private refreshSudo(): void {
    try {
      // Best effort: a failed refresh surfaces as a prompt or failure on the next sudo step.
      this.spawn('sudo', ['-n', '-v'], { stdio: 'ignore' }).once(
        'error',
        () => undefined,
      );
    } catch {
      // ignore: see above
    }
  }

  private exec(command: string, args: string[], label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: SpawnedProcess;
      try {
        child = this.spawn(command, args, { stdio: 'inherit' });
      } catch (cause) {
        reject(new StepError(label, null, { cause }));
        return;
      }
      child.once('error', (cause) =>
        reject(new StepError(label, null, { cause })),
      );
      child.once('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new StepError(label, code, { signal }));
      });
    });
  }
}

/** Writable sink for dry-run output; process.stdout satisfies it. */
export interface TextSink {
  write(chunk: string): unknown;
}

/** Prints each step's script with a [root]/[user] label and executes nothing. */
export class DryRunRunner implements Runner {
  constructor(private readonly out: TextSink = process.stdout) {}

  async asRoot(script: string, label: string): Promise<void> {
    this.print('root', script, label);
  }

  async asUser(script: string, label: string): Promise<void> {
    this.print('user', script, label);
  }

  private print(as: 'root' | 'user', script: string, label: string): void {
    this.out.write(`[${as}] ${label}\n${script.replace(/\n+$/, '')}\n\n`);
  }
}

export interface RecordedCall {
  as: 'root' | 'user';
  script: string;
  label: string;
}

/** Test helper: records calls; labels in `failLabels` reject with exit code 1. */
export class RecordingRunner implements Runner {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly failLabels: ReadonlySet<string> = new Set()) {}

  asRoot(script: string, label: string): Promise<void> {
    return this.record({ as: 'root', script, label });
  }

  asUser(script: string, label: string): Promise<void> {
    return this.record({ as: 'user', script, label });
  }

  private async record(call: RecordedCall): Promise<void> {
    this.calls.push(call);
    if (this.failLabels.has(call.label)) throw new StepError(call.label, 1);
  }
}
