import { MenuIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../../components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useActivityStatus } from '../../features/activity/activity-provider';
import type { StreamStatus } from '../../lib/activity';
import { cn } from '../../lib/utils';
import { findNavItem } from '../nav';
import { useRouter } from '../router';
import { useShellData } from '../shell-data';
import { Brand, SidebarNav, type SidebarFeatures } from './sidebar';
import { ThemeToggle } from './theme-toggle';

const STATUS: Record<
  StreamStatus,
  { label: string; dot: string; hint: string }
> = {
  live: {
    label: 'Live',
    dot: 'bg-run shadow-[0_0_8px_var(--run)] animate-live',
    hint: 'Connected to td. Commands stream live.',
  },
  connecting: {
    label: 'Connecting',
    dot: 'bg-warn',
    hint: 'Opening the activity stream.',
  },
  reconnecting: {
    label: 'Reconnecting',
    dot: 'bg-warn',
    hint: 'Lost the connection to td. Retrying.',
  },
  unavailable: {
    label: 'No stream',
    dot: 'bg-muted-foreground',
    hint: 'This td server has no activity stream.',
  },
  unauthorized: {
    label: 'Signed out',
    dot: 'bg-destructive',
    hint: 'The session expired.',
  },
};

function ConnectionStatus() {
  const { status, detail } = useActivityStatus();
  const s = STATUS[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="status"
          className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden className={cn('size-2 rounded-full', s.dot)} />
          <span>{s.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {s.hint}
        {detail && status !== 'live' ? ` (${detail})` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

export function TopBar({ features }: { features: SidebarFeatures }) {
  const { path } = useRouter();
  const { health } = useShellData();
  const [menuOpen, setMenuOpen] = useState(false);
  const title = findNavItem(path)?.label ?? 'Not found';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-4">
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
          >
            <MenuIcon aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Pages of the term dashboard
          </SheetDescription>
          <Brand />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav
              features={features}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
      <p className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
        <span className="text-muted-foreground md:hidden">td / </span>
        {title}
      </p>
      <ConnectionStatus />
      <ThemeToggle />
      <span
        className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline"
        title="td version"
      >
        {health.status === 'ready' ? `td v${health.data.version}` : 'td'}
      </span>
    </header>
  );
}
