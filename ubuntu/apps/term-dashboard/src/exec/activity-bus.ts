import {
  ACTIVITY_LIMITS,
  type ActivityEvent,
  type ActivityOutput,
} from '@linux-toolchain/term-config';

export type ActivityListener = (event: ActivityEvent) => void;

export interface ActivityLimits {
  maxCommands: number;
  maxBytes: number;
  maxOutputBytesPerCommand: number;
}

/**
 * In-memory pub/sub for command activity. Keeps a history of the most recent
 * commands (bounded by command count and by the serialized size of their
 * events) so a reconnecting client can replay it before live events.
 *
 * Output past `maxOutputBytesPerCommand` is dropped; when the command exits,
 * one `output` event with `truncatedBytes` replaces everything that was cut.
 */
export interface ActivityBus {
  publish(event: ActivityEvent): void;
  /** Events of the retained commands, oldest first. */
  history(): ActivityEvent[];
  subscribe(listener: ActivityListener): () => void;
}

interface CommandRecord {
  events: ActivityEvent[];
  bytes: number;
  outputBytes: number;
  droppedBytes: number;
  lastStream: ActivityOutput['stream'];
}

const eventBytes = (event: ActivityEvent) =>
  Buffer.byteLength(JSON.stringify(event));

/** The longest prefix of `text` that fits in `bytes` UTF-8 bytes. */
function utf8Prefix(text: string, bytes: number): string {
  const buf = Buffer.from(text);
  if (buf.length <= bytes) return text;
  let end = bytes;
  // Step back to a character boundary (continuation bytes are 10xxxxxx).
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString();
}

export function createActivityBus(
  limits: ActivityLimits = ACTIVITY_LIMITS,
  report: (message: string) => void = (m) => console.error(m),
): ActivityBus {
  const commands = new Map<string, CommandRecord>();
  const listeners = new Set<ActivityListener>();
  let totalBytes = 0;

  const evict = () => {
    for (const [id, record] of commands) {
      if (
        commands.size <= limits.maxCommands &&
        totalBytes <= limits.maxBytes
      ) {
        return;
      }
      // Never evict the command that is being written to if it is the only one.
      if (commands.size === 1) return;
      commands.delete(id);
      totalBytes -= record.bytes;
    }
  };

  const store = (record: CommandRecord, event: ActivityEvent) => {
    const size = eventBytes(event);
    record.events.push(event);
    record.bytes += size;
    totalBytes += size;
  };

  const emit = (event: ActivityEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        report(
          `td: activity listener failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  const deliver = (record: CommandRecord, event: ActivityEvent) => {
    store(record, event);
    evict();
    emit(event);
  };

  return {
    publish(event) {
      let record = commands.get(event.id);
      if (!record) {
        record = {
          events: [],
          bytes: 0,
          outputBytes: 0,
          droppedBytes: 0,
          lastStream: 'stdout',
        };
        commands.set(event.id, record);
      }
      if (event.type === 'output') {
        const size = Buffer.byteLength(event.chunk);
        const room = limits.maxOutputBytesPerCommand - record.outputBytes;
        if (record.droppedBytes > 0 || size > room) {
          const kept = room > 0 ? utf8Prefix(event.chunk, room) : '';
          const keptBytes = Buffer.byteLength(kept);
          record.outputBytes += keptBytes;
          record.droppedBytes += size - keptBytes;
          record.lastStream = event.stream;
          if (kept !== '') deliver(record, { ...event, chunk: kept });
          return;
        }
        record.outputBytes += size;
        deliver(record, event);
        return;
      }
      if (event.type === 'exited' && record.droppedBytes > 0) {
        deliver(record, {
          type: 'output',
          id: event.id,
          ts: event.ts,
          stream: record.lastStream,
          chunk: `[td: ${record.droppedBytes} more bytes of output not shown]\n`,
          truncatedBytes: record.droppedBytes,
        });
      }
      deliver(record, event);
    },
    history() {
      return [...commands.values()].flatMap((r) => r.events);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
