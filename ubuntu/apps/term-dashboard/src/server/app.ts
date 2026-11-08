import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createGuard, type AccessPolicy } from './guard';
import type { SessionStore } from './session';
import { createStaticHandler } from './static';

/** Request body limits: file contents get 1 MB, everything else 16 KB. */
export const BODY_LIMITS = {
  default: 16 * 1024,
  fileContent: 1024 * 1024,
} as const;

export interface Health {
  app: 'term-dashboard';
  version: string;
  pid: number;
}

export interface AppDeps {
  session: SessionStore;
  policy: AccessPolicy;
  version: string;
  pid: number;
  /** Folder with the built web UI; null when the UI is served elsewhere. */
  webRoot: string | null;
  /** Routes (matched on the path) that accept `BODY_LIMITS.fileContent`. */
  fileContentRoutes?: readonly RegExp[];
}

function limitBodies(fileContentRoutes: readonly RegExp[]): MiddlewareHandler {
  const tooLarge = (c: Parameters<MiddlewareHandler>[0]) =>
    c.json({ error: 'request body too large' }, 413);
  const small = bodyLimit({ maxSize: BODY_LIMITS.default, onError: tooLarge });
  const large = bodyLimit({
    maxSize: BODY_LIMITS.fileContent,
    onError: tooLarge,
  });
  return (c, next) =>
    fileContentRoutes.some((r) => r.test(c.req.path))
      ? large(c, next)
      : small(c, next);
}

/** Reads `{ [field]: string }` from a JSON body; null when malformed. */
async function stringField(
  req: Request,
  field: string,
  maxLength: number,
): Promise<string | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    console.error(`td: ${c.req.method} ${c.req.path}: ${error.message}`);
    return c.json({ error: 'internal error' }, 500);
  });

  app.use('*', createGuard(deps.policy, deps.session));
  app.use('/api/*', limitBodies(deps.fileContentRoutes ?? []));

  app.get('/api/health', (c) =>
    c.json<Health>({
      app: 'term-dashboard',
      version: deps.version,
      pid: deps.pid,
    }),
  );

  app.post('/api/session', async (c) => {
    const code = await stringField(c.req.raw, 'code', 256);
    if (code === null) return c.json({ error: 'expected { code }' }, 400);
    const token = deps.session.redeemLaunchCode(code);
    if (token === null) {
      return c.json({ error: 'invalid or expired launch code' }, 401);
    }
    return c.json({ token });
  });

  app.post('/api/launch-code', (c) =>
    c.json({ code: deps.session.mintLaunchCode() }),
  );

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  app.all('/ws/*', (c) => c.json({ error: 'not found' }, 404));

  if (deps.webRoot !== null) {
    const serveStatic = createStaticHandler(deps.webRoot);
    app.on(['GET', 'HEAD'], '*', serveStatic);
  }
  return app;
}
