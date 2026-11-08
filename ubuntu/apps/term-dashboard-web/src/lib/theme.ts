import type { Settings, ThemeMode } from '@linux-toolchain/term-config';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** sessionStorage key read by the pre-paint script in index.html. */
export const THEME_CACHE_KEY = 'td.theme';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** The theme currently on `<html>` (dark unless the cache said light). */
export function currentTheme(root: HTMLElement): ThemeMode {
  return root.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(
  theme: ThemeMode,
  root: HTMLElement,
  cache: Storage | null,
): void {
  root.classList.toggle('dark', theme === 'dark');
  try {
    cache?.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Storage can be unavailable (privacy mode); the class still applies.
  }
}

export interface ThemeBackend {
  load: () => Promise<Pick<Settings, 'theme'>>;
  save: (theme: ThemeMode) => Promise<unknown>;
}

interface ThemeValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

interface ThemeProviderProps {
  backend: ThemeBackend;
  /** Called when saving to settings.json fails; the theme still applies. */
  onSaveError?: (error: unknown) => void;
  root?: HTMLElement;
  cache?: Storage | null;
  children: ReactNode;
}

/**
 * Theme state. `settings.theme` from the API is authoritative and is applied
 * once it loads, unless the user picked a theme first; changes apply at once
 * and persist through `PUT /api/settings`.
 */
export function ThemeProvider({
  backend,
  onSaveError,
  root = document.documentElement,
  cache = safeSessionStorage(),
  children,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(() => currentTheme(root));
  // A choice made before the settings load wins over the loaded value
  // (the PUT for it may already have replaced that value on disk).
  const chosen = useRef(false);

  useEffect(() => {
    let active = true;
    backend.load().then(
      (settings) => {
        if (!active || chosen.current) return;
        applyTheme(settings.theme, root, cache);
        setThemeState(settings.theme);
      },
      () => {
        // Keep the cached theme when settings cannot be read.
      },
    );
    return () => {
      active = false;
    };
  }, [backend, root, cache]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      chosen.current = true;
      applyTheme(next, root, cache);
      setThemeState(next);
      backend.save(next).catch((error: unknown) => onSaveError?.(error));
    },
    [backend, root, cache, onSaveError],
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
