import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  ACTIVITY_LIMITS,
  API_PATHS,
  type ActivityEvent,
} from '@linux-toolchain/term-config';
import type { ActivityBus } from '../../exec/activity-bus';

/** A client this far behind is disconnected; it replays history on reconnect. */
const MAX_QUEUED_EVENTS = 10_000;

/**
 * `GET /api/activity`: SSE-formatted stream (`data: <ActivityEvent JSON>`),
 * read with `fetch` so the bearer header can be sent. History first, then
 * live events; a `: heartbeat` comment every 15 s keeps proxies and the
 * client's stall detection happy.
 */
export function activityRoutes(
  app: Hono,
  bus: ActivityBus,
  heartbeatMs: number = ACTIVITY_LIMITS.heartbeatMs,
): void {
  app.get(API_PATHS.activity, (c) =>
    streamSSE(c, async (stream) => {
      const queue: ActivityEvent[] = [];
      let wake: (() => void) | null = null;
      let done = false;
      const notify = () => {
        const w = wake;
        wake = null;
        w?.();
      };
      // Subscribe and snapshot in the same tick so no event is lost or doubled.
      const unsubscribe = bus.subscribe((event) => {
        if (queue.length >= MAX_QUEUED_EVENTS) {
          done = true;
        } else {
          queue.push(event);
        }
        notify();
      });
      queue.unshift(...bus.history());
      stream.onAbort(() => {
        done = true;
        notify();
      });
      try {
        while (!done && !stream.aborted) {
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({ data: JSON.stringify(event) });
            continue;
          }
          const timedOut = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          if (timedOut && !done) await stream.write(': heartbeat\n\n');
        }
      } finally {
        unsubscribe();
      }
    }),
  );
}
