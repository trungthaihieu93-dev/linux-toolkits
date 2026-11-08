/** Bytes queued on the socket above which terminal output stops being read. */
export const OUTPUT_HIGH_WATER = 1024 * 1024;
/** Queued bytes at or below which reading resumes. */
export const OUTPUT_LOW_WATER = 256 * 1024;
const POLL_MS = 25;

export interface OutputFlowOptions {
  /** Bytes the socket has accepted but not yet sent (`ws.bufferedAmount`). */
  buffered: () => number;
  /** Stop reading the terminal's output. */
  pause: () => void;
  /** Start reading it again. */
  resume: () => void;
  highWater?: number;
  lowWater?: number;
  pollMs?: number;
}

/**
 * Backpressure from a WebSocket to the terminal. When the browser cannot keep
 * up (a `yes` or a `cat` of a huge file), td stops reading `script`'s stdout,
 * the pipe fills and the producer blocks, instead of td buffering without
 * limit. `ws` has no drain event, so the queue is polled while paused.
 */
export class OutputFlow {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly high: number;
  private readonly low: number;

  constructor(private readonly opts: OutputFlowOptions) {
    this.high = opts.highWater ?? OUTPUT_HIGH_WATER;
    this.low = opts.lowWater ?? OUTPUT_LOW_WATER;
  }

  get paused(): boolean {
    return this.timer !== null;
  }

  /** Call after each chunk was handed to the socket. */
  sent(): void {
    if (this.timer !== null || this.opts.buffered() <= this.high) return;
    this.opts.pause();
    this.timer = setInterval(() => {
      if (this.opts.buffered() > this.low) return;
      this.dispose();
      this.opts.resume();
    }, this.opts.pollMs ?? POLL_MS);
  }

  /** Stop polling (the session or socket ended). */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
