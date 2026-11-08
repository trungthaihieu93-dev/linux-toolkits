export type Cleanup = () => void | Promise<void>;

/**
 * Teardown hooks run on shutdown (signal or normal stop). Later registrations
 * run first; a failing hook is reported and does not stop the others.
 */
export interface CleanupRegistry {
  /** Register `fn`; the returned function unregisters it. */
  register(fn: Cleanup): () => void;
  runAll(): Promise<void>;
}

export function createCleanupRegistry(
  report: (message: string) => void = (m) => console.error(m),
): CleanupRegistry {
  const hooks: Cleanup[] = [];
  return {
    register(fn) {
      hooks.push(fn);
      return () => {
        const i = hooks.indexOf(fn);
        if (i !== -1) hooks.splice(i, 1);
      };
    },
    async runAll() {
      while (hooks.length > 0) {
        const fn = hooks.pop() as Cleanup;
        try {
          await fn();
        } catch (error) {
          report(
            `td: cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
  };
}

/** SIGHUP covers closing the terminal td was started from. */
export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/** Conventional exit code for death by signal (128 + signal number). */
export const SIGNAL_EXIT_CODES: Readonly<Record<ShutdownSignal, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

/** Subscribe to shutdown signals; returns an unsubscribe function. */
export type SignalSource = (
  listener: (signal: ShutdownSignal) => void,
) => () => void;

export const processSignals: SignalSource = (listener) => {
  for (const sig of SHUTDOWN_SIGNALS) process.on(sig, listener);
  return () => {
    for (const sig of SHUTDOWN_SIGNALS) process.off(sig, listener);
  };
};
