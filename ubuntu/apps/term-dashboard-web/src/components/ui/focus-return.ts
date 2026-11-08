import { useRef } from 'react';

type FocusEventHandler = (event: Event) => void;

/**
 * Focus return for dialogs opened from code (no radix Trigger): radix would
 * focus the missing trigger on close and leave focus on <body>. This puts
 * focus back on the element that had it when the dialog opened, or on the
 * page's <main> when that element is gone or disabled.
 */
export function useFocusReturn(handlers: {
  onOpenAutoFocus?: FocusEventHandler;
  onCloseAutoFocus?: FocusEventHandler;
}): {
  onOpenAutoFocus: FocusEventHandler;
  onCloseAutoFocus: FocusEventHandler;
} {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      const active = document.activeElement;
      const content = event.target instanceof Node ? event.target : null;
      // An element inside the dialog (autoFocus) is not where focus returns.
      returnTo.current =
        active instanceof HTMLElement &&
        active !== document.body &&
        !content?.contains(active)
          ? active
          : null;
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      handlers.onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      const target = returnTo.current;
      returnTo.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
      // Removed, disabled or hidden elements do not take focus.
      if (!target || document.activeElement !== target) {
        document.getElementById('main')?.focus({ preventScroll: true });
      }
    },
  };
}
