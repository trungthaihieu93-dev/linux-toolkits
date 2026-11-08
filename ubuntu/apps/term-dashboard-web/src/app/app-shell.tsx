import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import { ActivityPanel } from './layout/activity-panel';
import { Sidebar, type SidebarFeatures } from './layout/sidebar';
import { TopBar } from './layout/top-bar';
import { useRouter } from './router';
import { FULL_HEIGHT_ROUTES, renderRoute } from './routes';
import { useInventory } from './shell-data';

/** Sidebar entries that depend on the inventory. */
function useFeatures(): SidebarFeatures {
  const inventory = useInventory();
  if (inventory.status !== 'ready') return { gnomeTerminal: false, zsh: true };
  const gnome = inventory.data.terminals.find(
    (t) => t.kind === 'gnome-terminal',
  );
  const zsh = inventory.data.shells.find((s) => s.shell === 'zsh');
  return {
    gnomeTerminal: Boolean(gnome?.installed && gnome.schemas),
    zsh: Boolean(zsh?.installed),
  };
}

export function AppShell() {
  const { path } = useRouter();
  const features = useFeatures();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  const fullHeight = FULL_HEIGHT_ROUTES.has(path);

  // Move focus to the page on navigation (not on first load).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo({ top: 0 });
  }, [path]);

  return (
    // overflow-clip (not hidden): the frame must never scroll itself, even
    // when focus or scrollIntoView targets something near its edge.
    <div className="flex h-dvh w-full overflow-clip">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 font-mono text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Sidebar features={features} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar features={features} />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            // relative: absolutely positioned descendants (sr-only text)
            // stay inside the scrolling area.
            'relative min-h-0 flex-1 focus:outline-none',
            fullHeight ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {renderRoute(path)}
        </main>
        <ActivityPanel />
      </div>
    </div>
  );
}
