import { Hono } from 'hono';
import type { ActivityEvent } from '@linux-toolchain/term-config';
import { createActivityBus } from '../../exec/activity-bus';
import { activityRoutes } from './activity';

/** Reads SSE frames from a streaming response until `count` frames arrived. */
async function readFrames(res: Response, count: number): Promise<string[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      frames.push(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  await reader.cancel();
  return frames;
}

const event = (id: string, type: 'started' | 'exited'): ActivityEvent =>
  type === 'started'
    ? { type, id, ts: 1, argv: ['true'] }
    : { type, id, ts: 2, code: 0, signal: null, durationMs: 1 };

describe('activityRoutes', () => {
  it('replays history, then streams live events as SSE data lines', async () => {
    const bus = createActivityBus();
    bus.publish(event('old', 'started'));
    bus.publish(event('old', 'exited'));
    const app = new Hono();
    activityRoutes(app, bus, 60_000);
    const res = await app.request('/api/activity');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    setTimeout(() => bus.publish(event('new', 'started')), 50);
    const frames = await readFrames(res, 3);
    const parsed = frames.map(
      (f) => JSON.parse(f.replace(/^data: /, '')) as ActivityEvent,
    );
    expect(parsed.map((e) => `${e.id}:${e.type}`)).toEqual([
      'old:started',
      'old:exited',
      'new:started',
    ]);
  });

  it('sends heartbeat comments while idle', async () => {
    const app = new Hono();
    activityRoutes(app, createActivityBus(), 30);
    const res = await app.request('/api/activity');
    const frames = await readFrames(res, 1);
    expect(frames[0]).toBe(': heartbeat');
  });
});
