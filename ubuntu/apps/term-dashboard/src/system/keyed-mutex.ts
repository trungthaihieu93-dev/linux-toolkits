/**
 * In-process async locks by key. Tasks that share a key run one at a time in
 * call order; tasks with different keys run concurrently. td is the only
 * writer it can coordinate with, so this makes read-check-write sequences
 * atomic within the process (not against other programs).
 */
export class KeyedMutex {
  /** Per key: resolves when the last queued task has released the lock. */
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => released);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /**
   * Hold every key in `keys` while `task` runs. Keys are taken in sorted
   * order, so overlapping calls cannot deadlock.
   */
  runAll<T>(keys: readonly string[], task: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const nest = (i: number): Promise<T> =>
      i === sorted.length ? task() : this.run(sorted[i], () => nest(i + 1));
    return nest(0);
  }
}
