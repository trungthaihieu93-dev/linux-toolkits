import { lazy, Suspense, type ReactNode } from 'react';
import { StatePanel } from '../components/state-panel';
import { OverviewPage } from '../features/overview/overview-page';
import { NotFoundPage } from '../features/placeholder/not-found-page';

// Each page is its own chunk; xterm.js and Monaco load only with the pages
// (and dialogs) that use them.
const TerminalPage = lazy(() =>
  import('../features/terminal/terminal-page').then((m) => ({
    default: m.TerminalPage,
  })),
);
const GhosttyPage = lazy(() =>
  import('../features/ghostty/ghostty-page').then((m) => ({
    default: m.GhosttyPage,
  })),
);
const TerminalSettingsPage = lazy(() =>
  import('../features/gsettings/terminal-settings-page').then((m) => ({
    default: m.TerminalSettingsPage,
  })),
);
const ShellPage = lazy(() =>
  import('../features/shells/shell-page').then((m) => ({
    default: m.ShellPage,
  })),
);
const BackupsPage = lazy(() =>
  import('../features/backups/backups-page').then((m) => ({
    default: m.BackupsPage,
  })),
);

const loading = (
  <div className="p-3 sm:p-6">
    <StatePanel tone="loading" title="Loading…" />
  </div>
);

function page(node: ReactNode): ReactNode {
  return <Suspense fallback={loading}>{node}</Suspense>;
}

export function renderRoute(path: string): ReactNode {
  switch (path) {
    case '/':
      return <OverviewPage />;
    case '/terminal':
      return page(<TerminalPage />);
    case '/ghostty':
      return page(<GhosttyPage />);
    case '/ptyxis':
      return page(<TerminalSettingsPage key="ptyxis" kind="ptyxis" />);
    case '/gnome-terminal':
      return page(
        <TerminalSettingsPage key="gnome-terminal" kind="gnome-terminal" />,
      );
    case '/shells/bash':
      return page(<ShellPage key="bash" shell="bash" />);
    case '/shells/zsh':
      return page(<ShellPage key="zsh" shell="zsh" />);
    case '/backups':
      return page(<BackupsPage />);
    default:
      return <NotFoundPage path={path} />;
  }
}

/** Pages that fill the main area edge to edge instead of scrolling. */
export const FULL_HEIGHT_ROUTES = new Set(['/terminal']);
