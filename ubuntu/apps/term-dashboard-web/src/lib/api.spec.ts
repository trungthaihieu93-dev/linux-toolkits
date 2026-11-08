import { ApiRequestError, createApiClient, describeError } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function client(response: () => Response | Promise<Response>) {
  const events = { onUnauthorized: vi.fn(), onConflict: vi.fn() };
  const fetchFn = vi.fn(async () => response());
  const api = createApiClient(
    'tok',
    events,
    fetchFn as unknown as typeof fetch,
  );
  return { api, events, fetchFn };
}

describe('createApiClient', () => {
  it('sends the bearer token and JSON body', async () => {
    const { api, fetchFn } = client(() => json({ theme: 'light', port: 0 }));
    await expect(api.updateSettings({ theme: 'light' })).resolves.toEqual({
      theme: 'light',
      port: 0,
    });
    const [path, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe('/api/settings');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"theme":"light"}');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('maps 401 to the session-expired event', async () => {
    const { api, events } = client(() => json({ error: 'no session' }, 401));
    const error = await api.settings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(401);
    expect(events.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(events.onConflict).not.toHaveBeenCalled();
  });

  it('maps 409 to the conflict event with the server message', async () => {
    const { api, events } = client(() =>
      json({ error: 'file changed on disk', detail: 'zshrc' }, 409),
    );
    await expect(
      api.request('POST', '/api/shells/zsh/raw/save', {}),
    ).rejects.toMatchObject({ status: 409, message: 'file changed on disk' });
    expect(events.onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409, detail: 'zshrc' }),
    );
    expect(events.onUnauthorized).not.toHaveBeenCalled();
  });

  it('reports a non-JSON error and an unreachable server', async () => {
    const proxy = client(() => new Response('Bad Gateway', { status: 502 }));
    await expect(proxy.api.inventory()).rejects.toMatchObject({
      status: 502,
      message: 'HTTP 502',
    });
    const down = client(() => Promise.reject(new TypeError('fetch failed')));
    await expect(down.api.health()).rejects.toMatchObject({ status: 0 });
  });

  it('explains a route that this server lacks', () => {
    expect(
      describeError(new ApiRequestError(404, 'not found'), 'the inventory'),
    ).toMatch(/does not provide the inventory/);
  });
});
