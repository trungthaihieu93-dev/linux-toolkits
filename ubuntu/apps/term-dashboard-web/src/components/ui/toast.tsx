import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  XIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before it hides; errors stay until dismissed by default. */
  durationMs?: number;
}

interface ToastItem extends Required<Omit<ToastInput, 'description'>> {
  id: number;
  description?: string;
}

type ToastFn = (toast: ToastInput) => void;

const ToastContext = createContext<ToastFn | null>(null);

const ICONS = {
  info: InfoIcon,
  success: CircleCheckIcon,
  error: CircleAlertIcon,
} as const;

const TONE = {
  info: 'text-link',
  success: 'text-run',
  error: 'text-destructive',
} as const;

/** A small dependency-free toast stack, announced through a live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    ({ title, description, tone = 'info', durationMs }) => {
      const id = nextId.current++;
      const duration = durationMs ?? (tone === 'error' ? 0 : 4000);
      setItems((list) => [
        ...list.slice(-3),
        { id, title, description, tone, durationMs: duration },
      ]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ol
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2"
      >
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <li
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-slide-in-up"
            >
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', TONE[t.tone])}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-medium">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 break-words text-sm text-muted-foreground">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-m-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <XIcon className="size-4" aria-hidden />
                <span className="sr-only">Dismiss</span>
              </button>
            </li>
          );
        })}
      </ol>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
