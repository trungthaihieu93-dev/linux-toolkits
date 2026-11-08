import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

interface WindowedListProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Height guess for rows not measured yet, in px. */
  estimate?: number;
  /** Extra px rendered above and below the visible area. */
  overscan?: number;
  /** Rows rendered before the first measurement (and in tests). */
  initialCount?: number;
  className?: string;
}

/** One rendered row, observed for its height while mounted. */
function Row({
  rowKey,
  observer,
  children,
}: {
  rowKey: string;
  observer: RefObject<ResizeObserver | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const obs = observer.current;
    if (!node || !obs) return undefined;
    obs.observe(node);
    return () => obs.unobserve(node);
  }, [observer]);
  return (
    <div ref={ref} data-window-key={rowKey}>
      {children}
    </div>
  );
}

/** The nearest scrolling ancestor (the page's `<main>` here), or the window. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * Plain windowing for long lists of variable-height rows (no dependency):
 * renders only the rows near the visible part of the scroll container and
 * keeps the scroll height with top and bottom spacers. Row heights are
 * measured with a ResizeObserver once rendered.
 */
export function WindowedList<T>({
  items,
  getKey,
  renderItem,
  estimate = 96,
  overscan = 800,
  initialCount = 30,
  className,
}: WindowedListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [range, setRange] = useState({ start: 0, end: initialCount });
  const [, setVersion] = useState(0);

  const heightOf = useCallback(
    (item: T) => heights.current.get(getKey(item)) ?? estimate,
    [getKey, estimate],
  );

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const parent = scrollParent(el);
    const viewTop = parent ? parent.getBoundingClientRect().top : 0;
    const viewHeight = parent ? parent.clientHeight : window.innerHeight;
    if (viewHeight === 0) return; // not laid out (tests, hidden tab)
    const listTop = el.getBoundingClientRect().top - viewTop;
    const from = -listTop - overscan;
    const to = -listTop + viewHeight + overscan;
    let offset = 0;
    let start = 0;
    while (start < items.length && offset + heightOf(items[start]) < from) {
      offset += heightOf(items[start]);
      start++;
    }
    let end = start;
    while (end < items.length && offset < to) {
      offset += heightOf(items[end]);
      end++;
    }
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, [items, heightOf, overscan]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const parent = scrollParent(ref.current);
    const target: HTMLElement | Window = parent ?? window;
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  // Measure rendered rows; re-window when a height changes. The observer
  // exists before the first row effect runs (child effects run first).
  const updateRef = useRef(update);
  updateRef.current = update;
  const observer = useRef<ResizeObserver | null>(null);
  if (observer.current === null && typeof ResizeObserver !== 'undefined') {
    observer.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset['windowKey'];
        if (!key) continue;
        const h = Math.ceil(entry.target.getBoundingClientRect().height);
        if (h > 0 && heights.current.get(key) !== h) {
          heights.current.set(key, h);
          changed = true;
        }
      }
      if (changed) {
        setVersion((v) => v + 1);
        updateRef.current();
      }
    });
  }
  useEffect(() => () => observer.current?.disconnect(), []);

  const start = Math.min(range.start, items.length);
  const end = Math.min(Math.max(range.end, start), items.length);
  let top = 0;
  for (let i = 0; i < start; i++) top += heightOf(items[i]);
  let bottom = 0;
  for (let i = end; i < items.length; i++) bottom += heightOf(items[i]);

  return (
    <div ref={ref} className={className}>
      <div aria-hidden style={{ height: top }} />
      {items.slice(start, end).map((item) => {
        const key = getKey(item);
        return (
          <Row key={key} rowKey={key} observer={observer}>
            {renderItem(item)}
          </Row>
        );
      })}
      <div aria-hidden style={{ height: bottom }} />
    </div>
  );
}
