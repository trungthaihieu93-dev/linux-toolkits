import { ChevronDownIcon, ChevronUpIcon, ListTreeIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ActivityList } from '../../features/activity/activity-list';
import {
  useActivityCommands,
  useActivityStatus,
} from '../../features/activity/activity-provider';

const STORAGE_KEY = 'td.activity-panel';
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;
const STEP = 24;

interface PanelState {
  open: boolean;
  height: number;
}

function initialState(): PanelState {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<PanelState> | null;
    if (saved && typeof saved.open === 'boolean') {
      return {
        open: saved.open,
        height:
          typeof saved.height === 'number' ? saved.height : DEFAULT_HEIGHT,
      };
    }
  } catch {
    // Fall through to the defaults.
  }
  // Collapsed by default on phones so the page keeps the screen.
  return {
    open: window.matchMedia('(min-width: 768px)').matches,
    height: DEFAULT_HEIGHT,
  };
}

const maxHeight = () =>
  Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.7));
const clamp = (h: number) => Math.min(maxHeight(), Math.max(MIN_HEIGHT, h));

/** Bottom panel with the live activity stream; drag or arrow keys resize it. */
export function ActivityPanel() {
  const commands = useActivityCommands();
  const { status } = useActivityStatus();
  const [state, setState] = useState<PanelState>(initialState);
  const drag = useRef<{ startY: number; startH: number } | null>(null);
  const running = commands.filter((c) => c.status === 'running').length;

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Not persisted; fine.
    }
  }, [state]);

  const setHeight = (h: number) =>
    setState((s) => ({ ...s, height: clamp(h) }));
  const height = clamp(state.height);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowUp: height + STEP,
      ArrowDown: height - STEP,
      PageUp: height + STEP * 4,
      PageDown: height - STEP * 4,
      Home: maxHeight(),
      End: MIN_HEIGHT,
    };
    if (e.key in keys) {
      e.preventDefault();
      setHeight(keys[e.key]);
    }
  };

  return (
    <section
      aria-label="Activity"
      className="flex shrink-0 flex-col border-t bg-card"
      style={state.open ? { height } : undefined}
    >
      {state.open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize activity panel"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={maxHeight()}
          aria-valuenow={height}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { startY: e.clientY, startH: height };
          }}
          onPointerMove={(e) => {
            if (drag.current) {
              setHeight(drag.current.startH + drag.current.startY - e.clientY);
            }
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className="group -mt-1.5 flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <span className="h-1 w-10 rounded-full bg-border transition-colors duration-150 group-hover:bg-primary group-focus-visible:bg-primary" />
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-2 px-2 sm:px-3">
        <button
          type="button"
          aria-expanded={state.open}
          aria-controls="activity-panel-body"
          onClick={() => setState((s) => ({ ...s, open: !s.open }))}
          className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 font-mono text-sm font-medium transition-colors duration-150 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ListTreeIcon className="size-4 text-muted-foreground" aria-hidden />
          Activity
          <span className="font-normal tabular-nums text-muted-foreground">
            {commands.length}
          </span>
          {running > 0 && (
            <span className="font-normal text-run">{running} running</span>
          )}
          {state.open ? (
            <ChevronDownIcon
              className="size-4 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <ChevronUpIcon
              className="size-4 text-muted-foreground"
              aria-hidden
            />
          )}
          <span className="sr-only">
            {state.open ? 'Collapse activity panel' : 'Expand activity panel'}
          </span>
        </button>
        {status === 'unavailable' && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            Activity stream unavailable on this td server.
          </span>
        )}
      </div>
      <div
        id="activity-panel-body"
        hidden={!state.open}
        className="min-h-0 flex-1 border-t"
      >
        {state.open && <ActivityList commands={commands} className="h-full" />}
      </div>
    </section>
  );
}
