import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('parses frames split across chunks', () => {
    const push = createSseParser();
    expect(push('event: activity\ndata: {"a"')).toEqual([]);
    expect(push(':1}\n')).toEqual([]);
    expect(push('\n')).toEqual([
      { event: 'activity', data: '{"a":1}', id: undefined },
    ]);
    const p2 = createSseParser();
    expect(p2('event: activity\ndata: {"a":1}\n\ndata: x\n\n')).toEqual([
      { event: 'activity', data: '{"a":1}', id: undefined },
      { event: 'message', data: 'x', id: undefined },
    ]);
  });

  it('joins multi-line data, keeps ids and skips comments', () => {
    const push = createSseParser();
    expect(push(': heartbeat\r\nid: 7\r\ndata: a\r\ndata: b\r\n\r\n')).toEqual([
      { event: 'message', data: 'a\nb', id: '7' },
    ]);
  });

  it('waits when a chunk ends between \\r and \\n', () => {
    const push = createSseParser();
    expect(push('data: a\r')).toEqual([]);
    expect(push('\n\r\n')).toEqual([
      { event: 'message', data: 'a', id: undefined },
    ]);
  });
});
