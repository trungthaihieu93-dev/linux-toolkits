import { useEffect, useState } from 'react';
import { authorizedFetch, establishSession } from './session';

interface Health {
  app: string;
  version: string;
  pid: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; health: Health }
  | { kind: 'error'; message: string };

/**
 * One session per page load: the launch code is single-use, so React
 * StrictMode's second effect run must not redeem it again.
 */
let session: Promise<string> | null = null;

async function load(): Promise<Health> {
  session ??= establishSession({
    fetch: (input, init) => fetch(input, init),
    storage: window.sessionStorage,
    location: window.location,
    replaceUrl: (url) => window.history.replaceState(null, '', url),
  });
  const token = await session;
  const res = await authorizedFetch(token)('/api/health');
  if (!res.ok) throw new Error(`Health check failed (HTTP ${res.status}).`);
  return (await res.json()) as Health;
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    load().then(
      (health) => active && setState({ kind: 'ready', health }),
      (error: unknown) =>
        active &&
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <h1 className="font-mono text-2xl font-semibold">td · term dashboard</h1>
      {state.kind === 'loading' && (
        <p className="text-slate-400">Connecting…</p>
      )}
      {state.kind === 'error' && (
        <p
          role="alert"
          className="rounded border border-red-500/50 p-4 text-red-300"
        >
          {state.message}
        </p>
      )}
      {state.kind === 'ready' && (
        <section
          aria-label="Server health"
          className="rounded border border-slate-700 p-4"
        >
          <h2 className="mb-2 text-sm font-medium text-slate-400">Server</h2>
          <pre className="font-mono text-sm text-emerald-300">
            {JSON.stringify(state.health, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}
