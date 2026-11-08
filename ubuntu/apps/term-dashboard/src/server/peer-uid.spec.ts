import {
  canonicalAddress,
  decodeAddress,
  findPeerUid,
  isPeerAllowed,
  parseProcNetTcp,
  readPeerUid,
} from './peer-uid';

const HEADER =
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const row = (
  n: number,
  local: string,
  remote: string,
  st: string,
  uid: number,
) =>
  `   ${n}: ${local} ${remote} ${st} 00000000:00000000 00:00000000 00000000  ${uid}        0 ${100 + n} 1 0000000000000000 100 0 0 10 0`;

// td listens on 127.0.0.1:4801 (0x12C1). Little-endian, as on x86 and arm64.
const TCP = [
  HEADER,
  row(0, '0100007F:12C1', '00000000:0000', '0A', 1000),
  // Our client 127.0.0.1:54321 (0xD431) and td's accepted end.
  row(1, '0100007F:D431', '0100007F:12C1', '01', 1000),
  row(2, '0100007F:12C1', '0100007F:D431', '01', 1000),
  // Another user's client 127.0.0.1:54322.
  row(3, '0100007F:D432', '0100007F:12C1', '01', 1001),
  'garbage line',
].join('\n');

const TCP6 = [
  HEADER,
  // ::ffff:127.0.0.1:54323 → ::ffff:127.0.0.1:4801, uid 1002.
  row(
    0,
    '0000000000000000FFFF00000100007F:D433',
    '0000000000000000FFFF00000100007F:12C1',
    '01',
    1002,
  ),
].join('\n');

const server = { address: '127.0.0.1', port: 4801 };

describe('decodeAddress', () => {
  it('reads little-endian IPv4 words', () => {
    expect(decodeAddress('0100007F', 'LE')).toBe('127.0.0.1');
    expect(decodeAddress('0F02000A', 'LE')).toBe('10.0.2.15');
    expect(decodeAddress('7F000001', 'BE')).toBe('127.0.0.1');
  });

  it('reads IPv6, unwrapping IPv4-mapped addresses', () => {
    expect(decodeAddress('00000000000000000000000001000000', 'LE')).toBe('::1');
    expect(decodeAddress('0000000000000000FFFF00000100007F', 'LE')).toBe(
      '127.0.0.1',
    );
    expect(decodeAddress('xyz', 'LE')).toBeNull();
  });

  it('puts socket addresses in the same form', () => {
    expect(canonicalAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(canonicalAddress('0:0:0:0:0:0:0:1')).toBe('::1');
    expect(canonicalAddress('not an address')).toBeNull();
  });
});

describe('findPeerUid', () => {
  const rows = parseProcNetTcp(TCP, 'LE');

  it('parses rows and skips malformed lines', () => {
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({
      local: { address: '127.0.0.1', port: 54321 },
      remote: { address: '127.0.0.1', port: 4801 },
      uid: 1000,
    });
  });

  it("finds the uid of the client end, not of td's accepted end", () => {
    expect(
      findPeerUid(rows, { address: '127.0.0.1', port: 54321 }, server),
    ).toBe(1000);
  });

  it("reports another user's connection with that user's uid", () => {
    const uid = findPeerUid(
      rows,
      { address: '127.0.0.1', port: 54322 },
      server,
    );
    expect(uid).toBe(1001);
    expect(isPeerAllowed(uid, 1000)).toBe(false);
  });

  it('returns null for a missing row, which is refused', () => {
    const uid = findPeerUid(
      rows,
      { address: '127.0.0.1', port: 60000 },
      server,
    );
    expect(uid).toBeNull();
    expect(isPeerAllowed(uid, 1000)).toBe(false);
    expect(isPeerAllowed(1000, 1000)).toBe(true);
  });

  it('matches IPv4-mapped rows of tcp6 against either address form', () => {
    const rows6 = parseProcNetTcp(TCP6, 'LE');
    for (const address of ['::ffff:127.0.0.1', '127.0.0.1']) {
      expect(
        findPeerUid(
          rows6,
          { address, port: 54323 },
          {
            address: '::ffff:127.0.0.1',
            port: 4801,
          },
        ),
      ).toBe(1002);
    }
  });
});

describe('readPeerUid', () => {
  it('checks tcp and tcp6, and retries once for a row not yet visible', async () => {
    let calls = 0;
    const read = vi.fn(async (path: string) => {
      calls++;
      if (path.endsWith('tcp6')) return TCP6;
      return calls > 2 ? TCP : HEADER;
    });
    const uid = await readPeerUid(
      { address: '127.0.0.1', port: 54321 },
      server,
      { read, retryMs: 1 },
    );
    expect(uid).toBe(1000);
    expect(read.mock.calls.map((c) => c[0])).toEqual([
      '/proc/net/tcp',
      '/proc/net/tcp6',
      '/proc/net/tcp',
    ]);
  });

  it('fails closed when no row turns up or /proc cannot be read', async () => {
    const missing = await readPeerUid(
      { address: '127.0.0.1', port: 60000 },
      server,
      { read: async () => TCP, retryMs: 1 },
    );
    expect(missing).toBeNull();
    const unreadable = await readPeerUid(
      { address: '127.0.0.1', port: 54321 },
      server,
      {
        read: async () => {
          throw new Error('EACCES');
        },
        retryMs: 1,
      },
    );
    expect(unreadable).toBeNull();
  });
});
