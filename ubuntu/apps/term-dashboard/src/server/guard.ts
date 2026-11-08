import type { MiddlewareHandler } from 'hono';
import type { SessionStore } from './session';

/**
 * Which Host headers and Origins the server accepts. The port is known only
 * after binding (`--port 0`), so it is read on every request.
 */
export interface AccessPolicy {
  port(): number;
  /** Extra origin for the Vite dev server (`--dev-origin`), if any. */
  devOrigin?: URL;
}

/** Routes reachable without the session token. */
const PUBLIC_ROUTES = new Set(['GET /api/health', 'POST /api/session']);
/** Routes authorised with the instance secret instead of the session token. */
const INSTANCE_ROUTES = new Set(['POST /api/launch-code']);

export function allowedHosts(policy: AccessPolicy): Set<string> {
  const port = policy.port();
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (policy.devOrigin) hosts.add(policy.devOrigin.host);
  return hosts;
}

export function allowedOrigins(policy: AccessPolicy): Set<string> {
  const port = policy.port();
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  if (policy.devOrigin) origins.add(policy.devOrigin.origin);
  return origins;
}

/** The credential from `Authorization: Bearer <value>`, if present. */
export function bearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(header ?? '');
  return match ? match[1] : null;
}

/** Entries of a comma-separated `Sec-WebSocket-Protocol` header. */
export function subprotocols(header: string | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Rejects requests that did not come from the dashboard:
 * - any Host outside the loopback allowlist (DNS rebinding): 403;
 * - a cross-origin `Origin` on API calls: 403;
 * - WebSocket upgrades without an allowed `Origin` (403) or without the
 *   session token as a subprotocol (401);
 * - `/api/*` calls without `Authorization: Bearer <token>` (401), except the
 *   public routes and the launch-code route, which takes the instance secret.
 */
export function createGuard(
  policy: AccessPolicy,
  session: SessionStore,
): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host') ?? '';
    if (!allowedHosts(policy).has(host)) {
      return c.json({ error: 'forbidden host' }, 403);
    }
    const origin = c.req.header('origin');
    const path = c.req.path;
    const isUpgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket';

    if (isUpgrade || path.startsWith('/ws/')) {
      if (!origin || !allowedOrigins(policy).has(origin)) {
        return c.json({ error: 'forbidden origin' }, 403);
      }
      const offered = subprotocols(c.req.header('sec-websocket-protocol'));
      if (!offered.some((p) => session.isSessionToken(p))) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      return next();
    }

    if (path === '/api' || path.startsWith('/api/')) {
      if (origin !== undefined && !allowedOrigins(policy).has(origin)) {
        return c.json({ error: 'forbidden origin' }, 403);
      }
      const route = `${c.req.method} ${path}`;
      if (PUBLIC_ROUTES.has(route)) return next();
      const credential = bearer(c.req.header('authorization'));
      const ok =
        credential !== null &&
        (INSTANCE_ROUTES.has(route)
          ? session.isInstanceSecret(credential)
          : session.isSessionToken(credential));
      if (!ok) return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  };
}
