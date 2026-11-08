import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ApiError } from '@linux-toolchain/term-config';
import { HttpError } from '../errors';
import { createGuard, type AccessPolicy } from './guard';
import { activityRoutes } from './routes/activity';
import { backupRoutes } from './routes/backups';
import { ghosttyRoutes } from './routes/ghostty';
import { gsettingsRoutes } from './routes/gsettings';
import { inventoryRoutes } from './routes/inventory';
import { ptyRoutes } from './routes/pty';
import { settingsRoutes } from './routes/settings';
import { shellRoutes } from './routes/shells';
import type { Services } from './services';
import { CHALLENGE_PATTERN, type SessionStore } from './session';
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
  /** HMAC of `?challenge=` keyed by the instance secret. */
  proof?: string;
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
  /** Backend services; without them only health, session and static are served. */
  services?: Services;
  /** One line per notable event for td's own terminal (never secrets). */
  notice?: (line: string) => void;
}

/** Routes whose bodies carry whole files or long edit lists. */
export const FILE_CONTENT_ROUTES: readonly RegExp[] = [
  /^\/api\/shells\/[^/]+\/(config|raw)\/(preview|save)$/,
  /^\/api\/ghostty\/(preview|save)$/,
];

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
    if (error instanceof HttpError) {
      const body: ApiError = { error: error.message };
      if (error.detail !== undefined) body.detail = error.detail;
      return c.json(body, error.status);
    }
    console.error(`td: ${c.req.method} ${c.req.path}: ${error.message}`);
    return c.json<ApiError>(
      { error: 'internal error', detail: error.message },
      500,
    );
  });

  // Defence in depth for a page that hosts a shell: never render in a frame.
  // A full CSP would need a hash for the inline pre-paint script.
  app.use('*', async (c, next) => {
    await next();
    if (c.res.status === 101) return;
    c.res.headers.set('x-frame-options', 'DENY');
    c.res.headers.set('content-security-policy', "frame-ancestors 'none'");
  });
  app.use('*', createGuard(deps.policy, deps.session));
  app.use(
    '/api/*',
    limitBodies([
      ...(deps.fileContentRoutes ?? []),
      ...(deps.services ? FILE_CONTENT_ROUTES : []),
    ]),
  );

  app.get('/api/health', (c) => {
    const health: Health = {
      app: 'term-dashboard',
      version: deps.version,
      pid: deps.pid,
    };
    const challenge = c.req.query('challenge');
    if (challenge !== undefined && CHALLENGE_PATTERN.test(challenge)) {
      health.proof = deps.session.instanceProof(challenge);
    }
    return c.json<Health>(health);
  });

  app.post('/api/session', async (c) => {
    const code = await stringField(c.req.raw, 'code', 256);
    if (code === null) return c.json({ error: 'expected { code }' }, 400);
    const token = deps.session.redeemLaunchCode(code);
    if (token === null) {
      return c.json({ error: 'invalid or expired launch code' }, 401);
    }
    deps.notice?.(
      `td: launch link used; browser session ${deps.session.sessionCount} started (if that was not you, stop td with Ctrl+C)`,
    );
    return c.json({ token });
  });

  app.post('/api/launch-code', (c) =>
    c.json({ code: deps.session.mintLaunchCode() }),
  );

  const s = deps.services;
  if (s) {
    settingsRoutes(app, s.settings);
    inventoryRoutes(app, s);
    gsettingsRoutes(app, s.gsettings);
    ghosttyRoutes(app, s.ghostty);
    shellRoutes(app, s.shells);
    backupRoutes(app, s);
    activityRoutes(app, s.bus);
    ptyRoutes(app, s.pty);
  }

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
  app.all('/ws/*', (c) => c.json({ error: 'not found' }, 404));

  if (deps.webRoot !== null) {
    const serveStatic = createStaticHandler(deps.webRoot);
    app.on(['GET', 'HEAD'], '*', serveStatic);
  }
  return app;
}
