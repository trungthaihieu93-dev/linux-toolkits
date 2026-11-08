import { lazy, Suspense, type ReactNode } from 'react';
import { StatePanel } from '../components/state-panel';
import { OverviewPage } from '../features/overview/overview-page';
import { NotFoundPage } from '../features/placeholder/not-found-page';
import { PendingPage } from '../features/placeholder/pending-page';

// xterm.js is loaded only when the Terminal page opens.
const TerminalPage = lazy(() =>
  import('../features/terminal/terminal-page').then((m) => ({
    default: m.TerminalPage,
  })),
);

/** Pages delivered by later steps of this build, shown as a stand-in. */
const PENDING: Record<string, string> = {
  '/ghostty': 'Ghostty',
  '/ptyxis': 'Ptyxis',
  '/gnome-terminal': 'GNOME Terminal',
  '/shells/bash': 'bash',
  '/shells/zsh': 'zsh',
  '/backups': 'Backups',
};

const loading = (
  <div className="p-3 sm:p-6">
    <StatePanel tone="loading" title="Loading…" />
  </div>
);

export function renderRoute(path: string): ReactNode {
  if (path === '/') return <OverviewPage />;
  if (path === '/terminal') {
    return (
      <Suspense fallback={loading}>
        <TerminalPage />
      </Suspense>
    );
  }
  const pending = PENDING[path];
  if (pending) return <PendingPage key={path} title={pending} />;
  return <NotFoundPage path={path} />;
}

/** Pages that fill the main area edge to edge instead of scrolling. */
export const FULL_HEIGHT_ROUTES = new Set(['/terminal']);
