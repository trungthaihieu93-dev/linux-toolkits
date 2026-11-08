import {
  API_PATHS,
  type ApiError,
  type Health,
  type Settings,
  type SettingsUpdate,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { authorizedFetch, establishSession, TOKEN_KEY } from './session';

/** A non-2xx API response. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** The route does not exist on this td server (older build). */
  get notFound(): boolean {
    return this.status === 404;
  }
}

export interface ApiEvents {
  /** 401 on any call: the session token is no longer valid. */
  onUnauthorized: () => void;
  /** 409 on a write: the file changed on disk since it was read. */
  onConflict: (error: ApiRequestError) => void;
}

export interface ApiClient {
  readonly token: string;
  /** `fetch` with the bearer header, for streams (activity). */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
  health(): Promise<Health>;
  settings(): Promise<Settings>;
  updateSettings(update: SettingsUpdate): Promise<Settings>;
  inventory(): Promise<TerminalInventory>;
}

async function errorFrom(res: Response): Promise<ApiRequestError> {
  let body: Partial<ApiError> = {};
  try {
    body = (await res.json()) as Partial<ApiError>;
  } catch {
    // Not JSON (proxy error page, empty body): keep the status text.
  }
  const message =
    typeof body.error === 'string' && body.error
      ? body.error
      : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  return new ApiRequestError(
    res.status,
    message,
    typeof body.detail === 'string' ? body.detail : undefined,
  );
}

/**
 * Typed JSON client for `/api/*`. Every call carries the session token in
 * the Authorization header; 401 and 409 are also reported through `events`
 * so the app can show the session-expired screen or the reload prompt.
 */
export function createApiClient(
  token: string,
  events: ApiEvents,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): ApiClient {
  const authed = authorizedFetch(token, fetchFn);

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await authed(path, init);
    } catch (cause) {
      throw new ApiRequestError(
        0,
        'td is not reachable. Is it still running?',
        cause instanceof Error ? cause.message : undefined,
      );
    }
    if (!res.ok) {
      const error = await errorFrom(res);
      if (res.status === 401) events.onUnauthorized();
      if (res.status === 409) events.onConflict(error);
      throw error;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    token,
    fetch: authed,
    request,
    get: (path) => request('GET', path),
    health: () => request('GET', API_PATHS.health),
    settings: () => request('GET', API_PATHS.settings),
    updateSettings: (update) => request('PUT', API_PATHS.settings, update),
    inventory: () => request('GET', API_PATHS.inventory),
  };
}

/** The session token for this tab (launch code exchange, see session.ts). */
export function connectSession(): Promise<string> {
  return establishSession({
    fetch: (input, init) => fetch(input, init),
    storage: window.sessionStorage,
    location: window.location,
    replaceUrl: (url) => window.history.replaceState(null, '', url),
  });
}

/** Forget the stored token so reopening td's URL starts a fresh session. */
export function forgetSession(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(TOKEN_KEY);
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiContext>');
  return api;
}

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiRequestError | Error };

/** Load one API resource; `reload` fetches it again. */
export function useResource<T>(
  load: (api: ApiClient) => Promise<T>,
): Resource<T> & { reload: () => void } {
  const api = useApi();
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    loadRef.current(api).then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) =>
        active &&
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
    return () => {
      active = false;
    };
  }, [api, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

/** A sentence for an error state: explains a missing route plainly. */
export function describeError(error: Error, what: string): string {
  if (error instanceof ApiRequestError && error.notFound) {
    return `This td server does not provide ${what}. Update td and restart it.`;
  }
  return error.message;
}
