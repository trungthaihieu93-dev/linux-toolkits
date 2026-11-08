import { readFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { endianness } from 'node:os';

/** One end of a TCP connection. */
export interface Endpoint {
  address: string;
  port: number;
}

/** A socket row of `/proc/net/tcp` or `/proc/net/tcp6`. */
export interface TcpRow {
  local: Endpoint;
  remote: Endpoint;
  uid: number;
}

export type Endianness = 'BE' | 'LE';

/**
 * The kernel prints each 32-bit word of an address with `%08X` on the
 * in-memory (network order) bytes, so on little-endian hosts every word
 * appears byte-reversed.
 */
function wordBytes(hex: string, order: Endianness): number[] | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  const bytes = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return order === 'LE' ? bytes.reverse() : bytes;
}

/**
 * Address text in one canonical form: dotted IPv4 (IPv4-mapped IPv6 is
 * unwrapped) or compressed lower-case IPv6.
 */
export function canonicalAddress(address: string): string | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIPv4(address)) return address;
  try {
    return new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** `0100007F` → `127.0.0.1`; 32 hex digits → IPv6 (v4-mapped unwrapped). */
export function decodeAddress(hex: string, order: Endianness): string | null {
  if (hex.length === 8) return wordBytes(hex, order)?.join('.') ?? null;
  if (hex.length !== 32) return null;
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 8) {
    const word = wordBytes(hex.slice(i, i + 8), order);
    if (!word) return null;
    bytes.push(...word);
  }
  const v4Mapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (v4Mapped) return bytes.slice(12).join('.');
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }
  return canonicalAddress(groups.join(':'));
}

function decodeEndpoint(field: string, order: Endianness): Endpoint | null {
  const [hexAddr, hexPort] = field.split(':');
  if (!hexAddr || !hexPort || !/^[0-9A-Fa-f]{4}$/.test(hexPort)) return null;
  const address = decodeAddress(hexAddr, order);
  // Ports are printed in host order already.
  return address === null ? null : { address, port: parseInt(hexPort, 16) };
}

/** Parse `/proc/net/tcp` or `/proc/net/tcp6` text; malformed rows are skipped. */
export function parseProcNetTcp(
  text: string,
  order: Endianness = endianness(),
): TcpRow[] {
  const rows: TcpRow[] = [];
  for (const line of text.split('\n').slice(1)) {
    // sl local_address rem_address st tx:rx tr:when retrnsmt uid ...
    const f = line.trim().split(/\s+/);
    if (f.length < 8) continue;
    const local = decodeEndpoint(f[1], order);
    const remote = decodeEndpoint(f[2], order);
    const uid = Number(f[7]);
    if (!local || !remote || !Number.isInteger(uid) || uid < 0) continue;
    rows.push({ local, remote, uid });
  }
  return rows;
}

const sameEndpoint = (a: Endpoint, b: Endpoint) =>
  a.port === b.port &&
  canonicalAddress(a.address) !== null &&
  canonicalAddress(a.address) === canonicalAddress(b.address);

/**
 * uid of the socket on the client side of a loopback connection: the row
 * whose local end is the client and whose remote end is the server. null when
 * there is no such row.
 */
export function findPeerUid(
  rows: readonly TcpRow[],
  client: Endpoint,
  server: Endpoint,
): number | null {
  const row = rows.find(
    (r) => sameEndpoint(r.local, client) && sameEndpoint(r.remote, server),
  );
  return row ? row.uid : null;
}

/** A connection is accepted only when its peer is known to be `ownUid`. */
export const isPeerAllowed = (peerUid: number | null, ownUid: number) =>
  peerUid !== null && peerUid === ownUid;

export const PROC_NET_TCP = ['/proc/net/tcp', '/proc/net/tcp6'] as const;

export interface ReadPeerUidOptions {
  read?: (path: string) => Promise<string>;
  /** Wait before the single retry, for a row not yet visible after accept. */
  retryMs?: number;
}

/** Look the client end of a loopback connection up in `/proc/net/tcp{,6}`. */
export async function readPeerUid(
  client: Endpoint,
  server: Endpoint,
  opts: ReadPeerUidOptions = {},
): Promise<number | null> {
  const read = opts.read ?? ((path: string) => readFile(path, 'utf8'));
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const path of PROC_NET_TCP) {
      const text = await read(path).catch(() => '');
      const uid = findPeerUid(parseProcNetTcp(text), client, server);
      if (uid !== null) return uid;
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, opts.retryMs ?? 25));
    }
  }
  return null;
}
