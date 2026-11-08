import type { Hono } from 'hono';
import { upgradeWebSocket } from '@hono/node-server';
import type { WSContext } from 'hono/ws';
import { API_PATHS } from '@linux-toolchain/term-config';
import { errorMessage } from '../../errors';
import {
  WS_CLOSE,
  type PtyConnection,
  type PtyManager,
} from '../../pty/pty-manager';

function safeClose(ws: WSContext, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

/**
 * `/ws/pty`: one PTY session per WebSocket. The guard has already checked
 * Origin and the token subprotocol; the WebSocketServer (see listen.ts)
 * selects `td` as the protocol and closes sockets on messages over 64 KB.
 * Terminal data is binary both ways; control messages are JSON text.
 */
export function ptyRoutes(app: Hono, pty: PtyManager): void {
  app.get(
    API_PATHS.pty,
    upgradeWebSocket(
      () => {
        let conn: PtyConnection | null = null;
        return {
          onOpen(_event, ws) {
            try {
              conn = pty.connect({
                // Output buffers come from child process pipes, never from a
                // SharedArrayBuffer, so the narrower type holds.
                send: (data) =>
                  ws.send(data as string | Uint8Array<ArrayBuffer>),
                close: (code, reason) => safeClose(ws, code, reason ?? ''),
                bufferedAmount: () =>
                  (ws.raw as { bufferedAmount?: number } | undefined)
                    ?.bufferedAmount ?? 0,
              });
            } catch (error) {
              safeClose(
                ws,
                WS_CLOSE.internal,
                errorMessage(error).slice(0, 120),
              );
            }
          },
          onMessage(event, ws) {
            try {
              const data: unknown = event.data;
              if (
                typeof data === 'string' ||
                data instanceof ArrayBuffer ||
                data instanceof Uint8Array
              ) {
                conn?.message(data);
              }
            } catch (error) {
              safeClose(
                ws,
                WS_CLOSE.internal,
                errorMessage(error).slice(0, 120),
              );
            }
          },
          onClose() {
            conn?.closed();
          },
          onError() {
            conn?.closed();
          },
        };
      },
      {
        onError: (error) =>
          console.error(`td: pty socket: ${errorMessage(error)}`),
      },
    ),
  );
}
