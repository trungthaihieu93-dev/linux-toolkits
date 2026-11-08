import {
  CircleAlertIcon,
  InboxIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

type Tone = 'loading' | 'empty' | 'error';

const ICON: Record<Tone, LucideIcon> = {
  loading: LoaderCircleIcon,
  empty: InboxIcon,
  error: CircleAlertIcon,
};

interface StatePanelProps {
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Loading, empty and error states, used inline in cards and pages. */
export function StatePanel({
  tone,
  title,
  children,
  action,
  className,
}: StatePanelProps) {
  const Icon = ICON[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col items-start gap-2 rounded-md border border-dashed p-4',
        tone === 'error' && 'border-destructive/50',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden
          className={cn(
            'size-4 shrink-0',
            tone === 'loading' && 'animate-spin text-muted-foreground',
            tone === 'empty' && 'text-muted-foreground',
            tone === 'error' && 'text-destructive',
          )}
        />
        <p className="font-mono text-sm font-medium">{title}</p>
      </div>
      {children && (
        <div className="text-sm text-muted-foreground">{children}</div>
      )}
      {action}
    </div>
  );
}
