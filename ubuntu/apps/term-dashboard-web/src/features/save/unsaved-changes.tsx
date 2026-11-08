import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from '../../app/router';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

interface UnsavedChangesGuard {
  /** Render once on the page: the "Discard unsaved changes?" dialog. */
  dialog: ReactNode;
  /**
   * Run `proceed` now when nothing is unsaved, otherwise after the user
   * confirms the discard (mode or file switches on the same page).
   */
  confirmDiscard: (proceed: () => void) => void;
}

/**
 * Guards unsaved edits: in-app navigation and back/forward ask first, and
 * closing or reloading the tab triggers the browser's own prompt.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  what = 'changes',
): UnsavedChangesGuard {
  const { block } = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return undefined;
    const unblock = block((proceed) => {
      setPending(() => proceed);
      return true;
    });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      unblock();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty, block]);

  const confirmDiscard = useCallback((proceed: () => void) => {
    if (!dirtyRef.current) proceed();
    else setPending(() => proceed);
  }, []);

  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved {what}?</AlertDialogTitle>
          <AlertDialogDescription>
            The edits on this page have not been saved. Leaving now discards
            them; nothing on disk changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            destructive
            onClick={() => {
              const proceed = pending;
              setPending(null);
              proceed?.();
            }}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { dialog, confirmDiscard };
}
