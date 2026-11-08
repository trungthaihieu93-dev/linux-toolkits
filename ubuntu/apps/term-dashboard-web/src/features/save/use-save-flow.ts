import type { SavePreview } from '@linux-toolchain/term-config';
import { useCallback, useRef, useState } from 'react';
import { useToast } from '../../components/ui/toast';
import { ApiRequestError, describeError } from '../../lib/api';
import type { SaveReviewDialogProps } from './save-review-dialog';

interface Review {
  previews: SavePreview[];
  warnings?: string[];
}

interface StartOptions {
  title: string;
  description?: string;
  applyLabel?: string;
  language?: string;
  /** Builds the previews (no writes). */
  preview: () => Promise<Review>;
  /** Writes; called with the previews the user reviewed. */
  apply: (previews: SavePreview[]) => Promise<void>;
}

type DialogProps = Omit<SaveReviewDialogProps, 'onOpenChange' | 'onApply'> & {
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
};

/** Text for a failed write: the check output for 422, the message otherwise. */
export function applyErrorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.detail ? `${error.message}\n${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * State of the preview → review → apply flow behind SaveReviewDialog. A 409
 * closes the dialog (the app-level "File changed on disk" prompt takes
 * over); other failures stay in the dialog so the user can cancel.
 */
export function useSaveFlow(): {
  start: (opts: StartOptions) => Promise<void>;
  previewing: boolean;
  dialog: DialogProps;
} {
  const toast = useToast();
  const [opts, setOpts] = useState<StartOptions | null>(null);
  const [review, setReview] = useState<Review>({ previews: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optsRef = useRef<StartOptions | null>(null);

  const start = useCallback(
    async (next: StartOptions) => {
      setPreviewing(true);
      try {
        const r = await next.preview();
        optsRef.current = next;
        setOpts(next);
        setReview(r);
        setError(null);
        setOpen(true);
      } catch (e) {
        if (!(e instanceof ApiRequestError && e.status === 409)) {
          toast({
            tone: 'error',
            title: 'Could not prepare the save',
            description:
              e instanceof Error ? describeError(e, 'this save') : String(e),
          });
        }
      } finally {
        setPreviewing(false);
      }
    },
    [toast],
  );

  const onApply = useCallback(async () => {
    const current = optsRef.current;
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await current.apply(review.previews);
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) setOpen(false);
      else setError(applyErrorText(e));
    } finally {
      setBusy(false);
    }
  }, [review]);

  return {
    start,
    previewing,
    dialog: {
      open,
      onOpenChange: setOpen,
      title: opts?.title ?? 'Review changes',
      description: opts?.description,
      applyLabel: opts?.applyLabel,
      language: opts?.language,
      previews: review.previews,
      warnings: review.warnings,
      busy,
      error,
      onApply: () => void onApply(),
    },
  };
}
