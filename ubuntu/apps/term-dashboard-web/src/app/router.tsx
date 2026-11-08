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

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  const pathRef = useRef(path);
  pathRef.current = path;
  const blockerRef = useRef<NavigationBlocker | null>(null);

  useEffect(() => {
    const onPop = () => {
      const target = window.location.pathname;
      const blocker = blockerRef.current;
      if (blocker && target !== pathRef.current) {
        // Put the current page back in the address bar until confirmed.
        window.history.pushState(null, '', pathRef.current);
        const held = blocker(() => {
          window.history.replaceState(null, '', target);
          setPath(target);
        });
        if (held) return;
        window.history.replaceState(null, '', target);
      }
      setPath(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback<RouterValue['navigate']>((to, opts) => {
    if (to === window.location.pathname) return;
    const go = () => {
      if (opts?.replace) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
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
