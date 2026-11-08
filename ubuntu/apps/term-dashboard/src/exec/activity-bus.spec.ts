import type { ActivityEvent } from '@linux-toolchain/term-config';
import { createActivityBus } from './activity-bus';

const started = (id: string): ActivityEvent => ({
  type: 'started',
  id,
  ts: 1,
  argv: ['echo', id],
});
const output = (id: string, chunk: string): ActivityEvent => ({
  type: 'output',
  id,
  ts: 2,
  stream: 'stdout',
  chunk,
});
const exited = (id: string): ActivityEvent => ({
  type: 'exited',
  id,
  ts: 3,
  code: 0,
  signal: null,
  durationMs: 2,
});

describe('createActivityBus', () => {
  it('delivers events live and keeps them in history', () => {
    const bus = createActivityBus();
    const seen: ActivityEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    bus.publish(started('a'));
    bus.publish(output('a', 'hi\n'));
    bus.publish(exited('a'));
    off();
    bus.publish(started('b'));
    expect(seen.map((e) => e.type)).toEqual(['started', 'output', 'exited']);
    expect(bus.history().map((e) => `${e.id}:${e.type}`)).toEqual([
      'a:started',
      'a:output',
      'a:exited',
      'b:started',
    ]);
  });

  it('evicts whole commands beyond the command cap', () => {
    const bus = createActivityBus({
      maxCommands: 2,
      maxBytes: 1e9,
      maxOutputBytesPerCommand: 1e9,
    });
    for (const id of ['a', 'b', 'c']) {
      bus.publish(started(id));
      bus.publish(exited(id));
    }
    expect(new Set(bus.history().map((e) => e.id))).toEqual(
      new Set(['b', 'c']),
    );
  });

  it('evicts the oldest commands beyond the byte cap', () => {
    const bus = createActivityBus({
      maxCommands: 100,
      maxBytes: 600,
      maxOutputBytesPerCommand: 1e9,
    });
    for (const id of ['a', 'b', 'c']) {
      bus.publish(started(id));
      bus.publish(output(id, 'x'.repeat(150)));
    }
    const ids = new Set(bus.history().map((e) => e.id));
    expect(ids.has('a')).toBe(false);
    expect(ids.has('c')).toBe(true);
    const bytes = bus
      .history()
      .reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
    expect(bytes).toBeLessThanOrEqual(600);
  });

  it('replaces output past the per-command cap with one marker before exit', () => {
    const bus = createActivityBus({
      maxCommands: 10,
      maxBytes: 1e9,
      maxOutputBytesPerCommand: 10,
    });
    const seen: ActivityEvent[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.publish(started('a'));
    bus.publish(output('a', '123456'));
    bus.publish(output('a', '7890abcd'));
    bus.publish(output('a', 'efgh'));
    bus.publish(exited('a'));
    const outputs = seen.filter((e) => e.type === 'output');
    expect(outputs.map((e) => e.chunk)).toEqual([
      '123456',
      '7890',
      expect.stringContaining('8 more bytes'),
    ]);
    expect(outputs[2].truncatedBytes).toBe(8);
    expect(seen[seen.length - 1].type).toBe('exited');
  });

  it('cuts on a UTF-8 character boundary', () => {
    const bus = createActivityBus({
      maxCommands: 10,
      maxBytes: 1e9,
      maxOutputBytesPerCommand: 4,
    });
    bus.publish(started('a'));
    bus.publish(output('a', 'aéé')); // 1 + 2 + 2 bytes
    bus.publish(exited('a'));
    const outputs = bus.history().filter((e) => e.type === 'output');
    expect(outputs[0].chunk).toBe('aé');
    expect(outputs[1].truncatedBytes).toBe(2);
  });

  it('keeps going when a listener throws', () => {
    const report = vi.fn();
    const bus = createActivityBus(undefined, report);
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => seen.push(e.type));
    bus.publish(started('a'));
    expect(seen).toEqual(['started']);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
