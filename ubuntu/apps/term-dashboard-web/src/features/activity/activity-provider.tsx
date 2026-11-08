import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityStore,
  connectActivity,
  type ActivityCommand,
  type StreamStatus,
} from '../../lib/activity';
import { useApi } from '../../lib/api';

interface ActivityValue {
  store: ActivityStore;
  status: StreamStatus;
  detail?: string;
}

const ActivityContext = createContext<ActivityValue | null>(null);

/** Owns the single activity stream of the page. */
export function ActivityProvider({
  children,
  onUnauthorized,
}: {
  children: ReactNode;
  onUnauthorized: () => void;
}) {
  const api = useApi();
  const store = useMemo(() => new ActivityStore(), []);
  const [state, setState] = useState<{
    status: StreamStatus;
    detail?: string;
  }>({ status: 'connecting' });

  useEffect(() => {
    const connect = () =>
      connectActivity({
        fetch: api.fetch,
        store,
        onStatus: (status, detail) => {
          setState({ status, detail });
          if (status === 'unauthorized') onUnauthorized();
        },
      });
    let disconnect: (() => void) | null = connect();
    // A page kept in the back/forward cache must not hold its stream open:
    // browsers allow 6 HTTP/1.1 connections per host, and parked pages
    // would starve the visible one. The server replays history on reconnect.
    const onHide = () => {
      disconnect?.();
      disconnect = null;
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && !disconnect) disconnect = connect();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      disconnect?.();
    };
  }, [api, store, onUnauthorized]);

  const value = useMemo(() => ({ store, ...state }), [store, state]);
  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

function useActivityContext(): ActivityValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('missing <ActivityProvider>');
  return ctx;
}

export function useActivityCommands(): readonly ActivityCommand[] {
  const { store } = useActivityContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useActivityStatus(): {
  status: StreamStatus;
  detail?: string;
} {
  const { status, detail } = useActivityContext();
  return { status, detail };
}
