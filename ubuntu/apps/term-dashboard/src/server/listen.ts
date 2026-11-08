import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createAdaptorServer,
  type WebSocketServerLike,
} from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { PTY_LIMITS, PTY_SUBPROTOCOL } from '@linux-toolchain/term-config';

/** The only interface td ever binds. */
export const LOOPBACK = '127.0.0.1';

export interface RunningServer {
  readonly port: number;
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

/** Bind `fetch` on 127.0.0.1:`port` (0 picks a free port). */
export function listen(
  fetch: FetchHandler,
  port: number,
  websocket?: WebSocketServerLike,
): Promise<RunningServer> {
  // createAdaptorServer without serverOptions/createServer builds a plain
  // node:http server, so the HTTP/2 members of its return type do not apply.
  const server = createAdaptorServer({
    fetch,
    hostname: LOOPBACK,
    ...(websocket ? { websocket: { server: websocket } } : {}),
  }) as Server;
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new PortInUseError(port) : error);
    };
    server.once('error', onError);
    server.listen(port, LOOPBACK, () => {
      server.off('error', onError);
      server.on('error', (error) => {
        console.error(`td: server error: ${error.message}`);
      });
      let closing: Promise<void> | null = null;
      resolve({
        port: (server.address() as AddressInfo).port,
        server,
        close() {
          closing ??= new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          });
          return closing;
        },
      });
    });
  });
}
