import {
  authorizedFetch,
  establishSession,
  readLaunchCode,
  SessionError,
  TOKEN_KEY,
  type SessionEnv,
} from './session';

function env(hash: string, fetchFn: SessionEnv['fetch'], stored?: string) {
  const store = new Map<string, string>(stored ? [[TOKEN_KEY, stored]] : []);
  const replaceUrl = vi.fn();
  const e: SessionEnv = {
    fetch: fetchFn,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    location: { hash, pathname: '/ghostty', search: '' },
    replaceUrl,
  };
  return { e, store, replaceUrl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('readLaunchCode', () => {
  it('reads a well-formed code from the fragment', () => {
    expect(readLaunchCode('#c=abc_DEF-1')).toBe('abc_DEF-1');
    expect(readLaunchCode('')).toBeNull();
    expect(readLaunchCode('#c=')).toBeNull();
    expect(readLaunchCode('#c=a%20b')).toBeNull();
  });
});

describe('establishSession', () => {
  it('redeems the code, stores the token and clears the fragment', async () => {
    const fetchFn = vi.fn(async () => json({ token: 'tok' }));
    const { e, store, replaceUrl } = env(
      '#c=code1',
      fetchFn as unknown as typeof fetch,
    );
    expect(await establishSession(e)).toBe('tok');
    expect(store.get(TOKEN_KEY)).toBe('tok');
    expect(replaceUrl).toHaveBeenCalledWith('/ghostty');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'code1' }),
      }),
    );
  });

  it('reuses the stored token without a code', async () => {
    const fetchFn = vi.fn();
    const { e } = env('', fetchFn as unknown as typeof fetch, 'old');
    expect(await establishSession(e)).toBe('old');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to the stored token when the code is spent', async () => {
    const { e } = env(
      '#c=spent',
      (async () => json({}, 401)) as unknown as typeof fetch,
      'old',
    );
    expect(await establishSession(e)).toBe('old');
  });

  it('explains an expired link and a missing session', async () => {
    const expired = env('#c=spent', (async () =>
      json({}, 401)) as unknown as typeof fetch);
    await expect(establishSession(expired.e)).rejects.toThrow(/expired/);
    const none = env('', vi.fn() as unknown as typeof fetch);
    await expect(establishSession(none.e)).rejects.toBeInstanceOf(SessionError);
  });
});

describe('authorizedFetch', () => {
  it('adds the bearer token', async () => {
    const fetchFn = vi.fn(async () => json({}));
    await authorizedFetch(
      'tok',
      fetchFn as unknown as typeof fetch,
    )('/api/health');
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });
});
