import {
  ACTIVITY_LIMITS,
  API_PATHS,
  type ActivityEvent,
  type ActivityStream,
} from '@linux-toolchain/term-config';
import { createSseParser } from './sse';

export interface OutputChunk {
  stream: ActivityStream;
  text: string;
  /** Set on the server's truncation notice: bytes that were dropped. */
  truncatedBytes?: number;
}

export type CommandStatus = 'running' | 'ok' | 'failed';

/** One backend command, folded from its started/output/exited events. */
export interface ActivityCommand {
  id: string;
  argv: string[];
  cwd?: string;
  startedAt: number;
  status: CommandStatus;
  code: number | null;
  signal: string | null;
  durationMs: number | null;
  error?: string;
  output: OutputChunk[];
  /** Bytes of event data held for this command (counts toward the cap). */
  bytes: number;
}

type Listener = () => void;

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/**
 * Client-side activity history with the same caps as the server: at most
 * `maxCommands` commands and `maxBytes` of event data; the oldest commands
 * are dropped first. Snapshots are immutable per change, for
 * `useSyncExternalStore`.
 */
export class ActivityStore {
  private byId = new Map<string, ActivityCommand>();
  private totalBytes = 0;
  private snapshot: readonly ActivityCommand[] = [];
  private dirty = false;
  private listeners = new Set<Listener>();

  constructor(
    private readonly limits: {
      maxCommands: number;
      maxBytes: number;
    } = ACTIVITY_LIMITS,
  ) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Commands in start order (oldest first). */
  getSnapshot = (): readonly ActivityCommand[] => {
    if (this.dirty) {
      this.snapshot = [...this.byId.values()];
      this.dirty = false;
    }
    return this.snapshot;
  };

  get bytes(): number {
    return this.totalBytes;
  }

  /** Drop everything (the server replays its history on every connect). */
  reset(): void {
    this.byId.clear();
    this.totalBytes = 0;
    this.changed();
  }

  /** Apply one event; `size` is its byte size on the wire when known. */
  apply(event: ActivityEvent, size = byteLength(JSON.stringify(event))): void {
    const prev = this.byId.get(event.id);
    let next: ActivityCommand;
    if (event.type === 'started') {
      if (prev) this.remove(prev);
      next = {
        id: event.id,
        argv: event.argv,
        cwd: event.cwd,
        startedAt: event.ts,
        status: 'running',
        code: null,
        signal: null,
        durationMs: null,
        output: [],
        bytes: size,
      };
    } else if (!prev) {
      // Its `started` event was evicted from the server's history.
      return;
    } else if (event.type === 'output') {
      const chunk: OutputChunk = { stream: event.stream, text: event.chunk };
      if (event.truncatedBytes !== undefined) {
        chunk.truncatedBytes = event.truncatedBytes;
      }
      next = {
        ...prev,
        output: [...prev.output, chunk],
        bytes: prev.bytes + size,
      };
    } else {
      next = {
        ...prev,
        status: event.code === 0 && !event.error ? 'ok' : 'failed',
        code: event.code,
        signal: event.signal,
        durationMs: event.durationMs,
        error: event.error,
        bytes: prev.bytes + size,
      };
    }
    this.totalBytes += size;
    this.byId.set(next.id, next);
    this.enforceLimits();
    this.changed();
  }

  private remove(cmd: ActivityCommand): void {
    this.byId.delete(cmd.id);
    this.totalBytes -= cmd.bytes;
  }

  private enforceLimits(): void {
    for (const cmd of this.byId.values()) {
      if (
        this.byId.size <= this.limits.maxCommands &&
        this.totalBytes <= this.limits.maxBytes
      ) {
        break;
      }
      // Always keep the newest command, even when it alone is over the cap.
      if (this.byId.size === 1) break;
      this.remove(cmd);
    }
  }

  private changed(): void {
    this.dirty = true;
    for (const l of this.listeners) l();
  }
}

export type StreamStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'unavailable'
  | 'unauthorized';

export interface ConnectOptions {
  /** Authorized fetch (bearer header); the token never goes in the URL. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  store: ActivityStore;
  onStatus: (status: StreamStatus, detail?: string) => void;
  /** Delay before reconnect attempt `n` (0-based). */
  backoffMs?: (attempt: number) => number;
}

const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];
const defaultBackoff = (n: number) => BACKOFF[Math.min(n, BACKOFF.length - 1)];

/**
 * Read `/api/activity` as an SSE stream over `fetch` + `ReadableStream`,
 * reconnecting with backoff. Stops on 401 (session gone) and 404 (this td
 * server has no activity route). Returns a function that stops it.
 */
export function connectActivity(opts: ConnectOptions): () => void {
  const controller = new AbortController();
  const backoff = opts.backoffMs ?? defaultBackoff;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const retry = (detail?: string) => {
    if (controller.signal.aborted) return;
    opts.onStatus('reconnecting', detail);
    timer = setTimeout(run, backoff(attempt++));
  };

  async function run(): Promise<void> {
    if (controller.signal.aborted) return;
    let res: Response;
    try {
      res = await opts.fetch(API_PATHS.activity, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      return retry(error instanceof Error ? error.message : undefined);
    }
    if (res.status === 401) return opts.onStatus('unauthorized');
    if (res.status === 404) {
      return opts.onStatus(
        'unavailable',
        'This td server has no activity stream.',
      );
    }
    if (!res.ok || !res.body) return retry(`HTTP ${res.status}`);

    attempt = 0;
    opts.store.reset();
    opts.onStatus('live');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parse = createSseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const msg of parse(decoder.decode(value, { stream: true }))) {
          if (msg.event !== 'message' && msg.event !== 'activity') continue;
          let event: ActivityEvent;
          try {
            event = JSON.parse(msg.data) as ActivityEvent;
          } catch {
            continue;
          }
          opts.store.apply(event, byteLength(msg.data));
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      return retry(error instanceof Error ? error.message : undefined);
    }
    retry('stream ended');
  }

  opts.onStatus('connecting');
  void run();
  return () => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** argv as one shell-safe line (for "copy command"). */
export function quoteArgv(argv: readonly string[]): string {
  return argv
    .map((a) =>
      a !== '' && /^[\w@%+=:,./-]+$/.test(a)
        ? a
        : `'${a.replace(/'/g, `'\\''`)}'`,
    )
    .join(' ');
}
