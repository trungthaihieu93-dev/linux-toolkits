import type { ThemeMode } from '@linux-toolchain/term-config';
import {
  KeyRoundIcon,
  LoaderCircleIcon,
  PlugZapIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppShell } from './app/app-shell';
import { RouterProvider } from './app/router';
import { ShellDataProvider } from './app/shell-data';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog';
import { ToastProvider, useToast } from './components/ui/toast';
import { TooltipProvider } from './components/ui/tooltip';
import { ActivityProvider } from './features/activity/activity-provider';
import {
  ApiContext,
  connectSession,
  createApiClient,
  describeError,
  forgetSession,
  type ApiClient,
  type ApiRequestError,
} from './lib/api';
import { ThemeProvider, type ThemeBackend } from './lib/theme';

/**
 * One session per page load: the launch code is single-use, so React
 * StrictMode's second effect run must not redeem it again.
 */
let session: Promise<string> | null = null;

type Boot =
  | { kind: 'loading' }
  | { kind: 'ready'; token: string }
  | { kind: 'error'; message: string };

function FullScreen({
  icon: Icon,
  title,
  children,
  spin = false,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  spin?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div
        role={spin ? 'status' : 'alert'}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <Icon
            aria-hidden
            className={
              spin
                ? 'size-5 animate-spin text-muted-foreground'
                : 'size-5 text-destructive'
            }
          />
          <h1 className="font-mono text-base font-semibold">{title}</h1>
        </div>
        {children && (
          <div className="text-sm text-muted-foreground">{children}</div>
        )}
      </div>
    </main>
  );
}

export function SessionExpiredScreen() {
  return (
    <FullScreen icon={KeyRoundIcon} title="Session expired">
      <p>
        Session expired: restart <code className="text-foreground">td</code> or
        reopen its URL.
      </p>
      <p className="mt-2">
        Running <code className="text-foreground">td</code> again opens a new
        tab with a fresh link.
      </p>
    </FullScreen>
  );
}

function ConflictPrompt({
  error,
  onClose,
}: {
  error: ApiRequestError | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={error !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>File changed on disk</AlertDialogTitle>
          <AlertDialogDescription>
            The file was changed outside td after this page read it, so td did
            not overwrite it. Reload to see the current version; unsaved edits
            on this page will be lost.
            {error?.detail ? ` (${error.detail})` : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => window.location.reload()}>
            Reload
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Dashboard({
  api,
  onUnauthorized,
}: {
  api: ApiClient;
  onUnauthorized: () => void;
}) {
  const toast = useToast();
  const backend = useMemo<ThemeBackend>(
    () => ({
      load: () => api.settings(),
      save: (theme: ThemeMode) => api.updateSettings({ theme }),
    }),
    [api],
  );
  const onSaveError = useCallback(
    (error: unknown) =>
      toast({
        tone: 'error',
        title: 'Theme not saved',
        description: `It applies to this tab only. ${
          error instanceof Error ? describeError(error, 'settings storage') : ''
        }`.trim(),
      }),
    [toast],
  );

  return (
    <ApiContext.Provider value={api}>
      <ThemeProvider backend={backend} onSaveError={onSaveError}>
        <ActivityProvider onUnauthorized={onUnauthorized}>
          <ShellDataProvider>
            <AppShell />
          </ShellDataProvider>
        </ActivityProvider>
      </ThemeProvider>
    </ApiContext.Provider>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [expired, setExpired] = useState(false);
  const [conflict, setConflict] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    let active = true;
    session ??= connectSession();
    session.then(
      (token) => active && setBoot({ kind: 'ready', token }),
      (error: unknown) =>
        active &&
        setBoot({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, []);

  const onUnauthorized = useCallback(() => {
    forgetSession(window.sessionStorage);
    setExpired(true);
  }, []);

  const api = useMemo(
    () =>
      boot.kind === 'ready'
        ? createApiClient(boot.token, {
            onUnauthorized,
            onConflict: setConflict,
          })
        : null,
    [boot, onUnauthorized],
  );

  if (expired) return <SessionExpiredScreen />;
  if (boot.kind === 'loading') {
    return (
      <FullScreen icon={LoaderCircleIcon} title="Connecting to td…" spin />
    );
  }
  if (boot.kind === 'error' || !api) {
    return (
      <FullScreen icon={PlugZapIcon} title="Not connected">
        <p>{boot.kind === 'error' ? boot.message : 'No session.'}</p>
      </FullScreen>
    );
  }

  return (
    <RouterProvider>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>
          <Dashboard api={api} onUnauthorized={onUnauthorized} />
          <ConflictPrompt error={conflict} onClose={() => setConflict(null)} />
        </ToastProvider>
      </TooltipProvider>
    </RouterProvider>
  );
}
