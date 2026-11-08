/** One server-sent event frame. */
export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental parser for the `text/event-stream` format. Feed it decoded
 * text in arbitrary chunks; it returns the frames completed so far.
 * Comment lines (`: heartbeat`) are ignored.
 */
export function createSseParser(): (chunk: string) => SseMessage[] {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;

  const dispatch = (out: SseMessage[]) => {
    if (data.length > 0) {
      out.push({ event: event || 'message', data: data.join('\n'), id });
    }
    event = '';
    data = [];
    id = undefined;
  };

  return (chunk) => {
    buffer += chunk;
    const out: SseMessage[] = [];
    let nl: number;
    while ((nl = buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = buffer.slice(0, nl);
      // A lone trailing '\r' may be the first half of '\r\n': wait for more.
      if (buffer[nl] === '\r' && nl === buffer.length - 1) break;
      buffer = buffer.slice(nl + (buffer.startsWith('\r\n', nl) ? 2 : 1));
      if (line === '') {
        dispatch(out);
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
    }
    return out;
  };
}
