import type { Server, ServerOptions } from 'node:http';
import {
  createServer as createNetServer,
  type AddressInfo,
  type Socket,
} from 'node:net';
import {
  createAdaptorServer,
  type WebSocketServerLike,
} from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { PTY_LIMITS, PTY_SUBPROTOCOL } from '@linux-toolchain/term-config';
import { isPeerAllowed, readPeerUid, type Endpoint } from './peer-uid';

/** The only interface td ever binds. */
export const LOOPBACK = '127.0.0.1';

export interface RunningServer {
  readonly port: number;
  /** The HTTP server; it never listens itself (see `listen`). */
  readonly server: Server;
  /** Stop accepting connections and drop the open ones. Idempotent. */
  close(): Promise<void>;
}

export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`port ${port} is already in use`);
    this.name = 'PortInUseError';
  }
}

type FetchHandler = Parameters<typeof createAdaptorServer>[0]['fetch'];

/**
 * WebSocket server for `upgradeWebSocket` routes. It answers with the `td`
 * subprotocol only (never echoing the token the client also offered) and
 * closes a socket (1009) on any message over `PTY_LIMITS.maxMessageBytes`.
 */
export function createWebSocketServer(): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    maxPayload: PTY_LIMITS.maxMessageBytes,
    handleProtocols: (protocols) =>
      protocols.has(PTY_SUBPROTOCOL) ? PTY_SUBPROTOCOL : false,
  });
}

/** Who may connect: only sockets owned by `uid` on the client side. */
export interface PeerPolicy {
  uid: number;
  /** Owner uid of the client end; defaults to `/proc/net/tcp{,6}`. */
  peerUid?: (client: Endpoint, server: Endpoint) => Promise<number | null>;
  /** Called for each refused connection with the uid found (null: none). */
  onRefused?: (uid: number | null) => void;
}

/** HTTP timeouts; Node's defaults apply to anything left out. */
export type HttpTimeouts = Pick<
  ServerOptions,
  'headersTimeout' | 'requestTimeout' | 'connectionsCheckingInterval'
>;

export interface ListenOptions {
  websocket?: WebSocketServerLike;
  peer: PeerPolicy;
  http?: HttpTimeouts;
}

/**
 * Bind `fetch` on 127.0.0.1:`port` (0 picks a free port).
 *
 * Loopback is shared by every user on the host, so each accepted connection
 * is paused and handed to the HTTP server only after the uid that owns its
 * client end (from `/proc/net/tcp`) is ours. Anything else, including a
 * connection whose owner cannot be found, is destroyed before a byte of it
 * is read; this covers HTTP and WebSocket upgrades alike.
 *
 * The gate tracks every socket it accepted, so `close()` can destroy them:
 * the HTTP server never sees them as its own, and `gate.close()` alone would
 * wait for each one to end (an open activity stream never does).
 */
export function listen(
  fetch: FetchHandler,
  port: number,
  opts: ListenOptions,
): Promise<RunningServer> {
  const { websocket, peer, http } = opts;
  // createAdaptorServer without serverOptions/createServer builds a plain
  // node:http server, so the HTTP/2 members of its return type do not apply.
  // It never listens itself: the gate below passes it checked sockets.
  const server = createAdaptorServer({
    fetch,
    hostname: LOOPBACK,
    ...(http ? { serverOptions: http } : {}),
    ...(websocket ? { websocket: { server: websocket } } : {}),
  }) as Server;
  const peerUid = peer.peerUid ?? readPeerUid;
  /** Every accepted socket that is still open, checked or not. */
  const sockets = new Set<Socket>();
  let closed = false;

  const admit = async (socket: Socket): Promise<void> => {
    const ignore = () => undefined;
    socket.on('error', ignore);
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const client = { address: socket.remoteAddress, port: socket.remotePort };
    const local = { address: socket.localAddress, port: socket.localPort };
    let uid: number | null = null;
    if (client.address && client.port && local.address && local.port) {
      try {
        uid = await peerUid(
          { address: client.address, port: client.port },
          { address: local.address, port: local.port },
        );
      } catch {
        uid = null;
      }
    }
    if (socket.destroyed) return;
    if (closed) {
      socket.destroy();
      return;
    }
    if (!isPeerAllowed(uid, peer.uid)) {
      peer.onRefused?.(uid);
      socket.destroy();
      return;
    }
    socket.off('error', ignore);
    server.emit('connection', socket);
    socket.resume();
  };
  const gate = createNetServer({ pauseOnConnect: true }, (socket) => {
    void admit(socket);
  });

  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortInUseError(port) : error);
    };
    gate.once('error', onError);
    gate.listen(port, LOOPBACK, () => {
      gate.off('error', onError);
      gate.on('error', (error) => {
        console.error(`td: server error: ${error.message}`);
      });
      // Node starts an HTTP server's connection tracking (the list behind
      // closeAllConnections and the header/request timeout checker) on its
      // 'listening' event, which a server that never listens does not emit.
      server.emit('listening');
      let closing: Promise<void> | null = null;
      resolve({
        port: (gate.address() as AddressInfo).port,
        server,
        close() {
          closing ??= new Promise<void>((done) => {
            closed = true;
            gate.close(() => done());
            for (const socket of sockets) socket.destroy();
            // Stops the timeout checker; the server itself never listened,
            // so the callback only reports ERR_SERVER_NOT_RUNNING.
            server.close(() => undefined);
          });
          return closing;
        },
      });
    });
  });
}
