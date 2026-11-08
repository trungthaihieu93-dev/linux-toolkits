import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/**
 * A small router on the History API. The td server falls back to
 * index.html for unknown paths, so deep links work on reload.
 */

/**
 * Called before a navigation. Return true to hold it; the blocker then calls
 * `proceed` once the user confirms (for example after discarding edits).
 */
export type NavigationBlocker = (proceed: () => void) => boolean;

interface NavigateOptions {
  replace?: boolean;
  /** Skip the blocker (used by `proceed`). */
  force?: boolean;
}

interface RouterValue {
  path: string;
  navigate: (to: string, opts?: NavigateOptions) => void;
  /** Install a blocker; returns the function that removes it. */
  block: (blocker: NavigationBlocker) => () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/**
 * Each history entry this router makes carries its position in
 * `history.state`, so a held back/forward step can be undone and redone
 * with `history.go` without adding or cutting entries.
 */
const INDEX_KEY = 'tdIndex';

function entryIndex(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const index = (state as Record<string, unknown>)[INDEX_KEY];
  return typeof index === 'number' ? index : null;
}

function initialIndex(): number {
  const index = entryIndex(window.history.state);
  if (index !== null) return index;
  window.history.replaceState({ [INDEX_KEY]: 0 }, '', window.location.href);
  return 0;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  const pathRef = useRef(path);
  pathRef.current = path;
  const blockerRef = useRef<NavigationBlocker | null>(null);
  const [startIndex] = useState(initialIndex);
  const indexRef = useRef(startIndex);
  // Set before a `history.go` the router makes itself, so the popstate it
  // causes is not treated as the user's.
  const pendingRef = useRef<'undo' | 'redo' | null>(null);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const target = window.location.pathname;
      const index = entryIndex(event.state);
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending === 'undo') {
        // Back on the page the user has not left yet.
        if (index !== null) indexRef.current = index;
        return;
      }
      const blocker = blockerRef.current;
      if (pending !== 'redo' && blocker && target !== pathRef.current) {
        const delta = index !== null ? index - indexRef.current : 0;
        if (delta !== 0) {
          // Step back to the current entry until the user confirms, then
          // take the same step again.
          const held = blocker(() => {
            pendingRef.current = 'redo';
            window.history.go(delta);
          });
          if (held) {
            pendingRef.current = 'undo';
            window.history.go(-delta);
            return;
          }
        } else {
          // An entry this router did not make (no index): put the current
          // page back in the address bar until confirmed.
          window.history.pushState(
            { [INDEX_KEY]: indexRef.current + 1 },
            '',
            pathRef.current,
          );
          const held = blocker(() => {
            window.history.replaceState(
              { [INDEX_KEY]: indexRef.current },
              '',
              target,
            );
            setPath(target);
          });
          indexRef.current = indexRef.current + 1;
          if (held) return;
          window.history.replaceState(
            { [INDEX_KEY]: indexRef.current },
            '',
            target,
          );
        }
      } else if (index !== null) {
        indexRef.current = index;
      }
      setPath(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback<RouterValue['navigate']>((to, opts) => {
    if (to === window.location.pathname) return;
    const go = () => {
      const current = indexRef.current;
      if (opts?.replace) {
        window.history.replaceState({ [INDEX_KEY]: current }, '', to);
      } else {
        indexRef.current = current + 1;
        window.history.pushState({ [INDEX_KEY]: current + 1 }, '', to);
      }
      setPath(to);
    };
    const blocker = blockerRef.current;
    if (!opts?.force && blocker && blocker(go)) return;
    go();
  }, []);

  const block = useCallback<RouterValue['block']>((blocker) => {
    blockerRef.current = blocker;
    return () => {
      if (blockerRef.current === blocker) blockerRef.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({ path, navigate, block }),
    [path, navigate, block],
  );
  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside <RouterProvider>');
  return ctx;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
};

/** An `<a>` that navigates in-app on a plain left click. */
export function Link({ to, onClick, ...props }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...props} />;
}
