/** sessionStorage key of the API session token. */
export const TOKEN_KEY = 'td.session';

/** The launch code from a `#c=<code>` fragment, if present. */
export function readLaunchCode(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const code = params.get('c');
  return code && /^[A-Za-z0-9_-]{1,256}$/.test(code) ? code : null;
}

export interface SessionEnv {
  fetch: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  /** Replace the address bar URL (drops the spent launch code). */
  replaceUrl: (url: string) => void;
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * Get the session token: redeem the launch code in the fragment (and clear
 * it from the address bar), or reuse the token kept in sessionStorage.
 */
export async function establishSession(env: SessionEnv): Promise<string> {
  const code = readLaunchCode(env.location.hash);
  if (code === null) {
    const stored = env.storage.getItem(TOKEN_KEY);
    if (stored) return stored;
    throw new SessionError(
      'No session. Run `td` in a terminal and open the link it prints.',
    );
  }
  // The code is single-use either way: drop it from the URL and history now.
  env.replaceUrl(`${env.location.pathname}${env.location.search}`);
  const res = await env.fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const stored = env.storage.getItem(TOKEN_KEY);
    if (stored) return stored;
    throw new SessionError(
      res.status === 401
        ? 'This link has expired or was already used. Run `td` again for a new one.'
        : `Could not start a session (HTTP ${res.status}).`,
      res.status,
    );
  }
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new SessionError('The server returned no session token.');
  }
  env.storage.setItem(TOKEN_KEY, body.token);
  return body.token;
}

/** `fetch` for `/api/*` with the session token in the Authorization header. */
export function authorizedFetch(token: string, fetchFn: typeof fetch = fetch) {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetchFn(path, { ...init, headers });
  };
}
