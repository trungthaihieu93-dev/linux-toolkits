import { LoaderCircleIcon, SaveIcon, Undo2Icon } from 'lucide-react';
import { Button } from '../../components/ui/button';

/**
 * Sticky bar at the bottom of a page with staged edits: count, Discard and
 * "Review and save" (CTA colour), which opens SaveReviewDialog.
 */
export function SaveBar({
  count,
  label,
  busy,
  disabled,
  disabledReason,
  onDiscard,
  onReview,
}: {
  count: number;
  /** E.g. "unsaved change" (pluralised with an s). */
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onDiscard: () => void;
  onReview: () => void;
}) {
  if (count === 0) return null;
  const noun = label ?? 'unsaved change';
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-0 z-10 -mx-3 flex flex-col gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:px-6"
    >
      <p className="font-mono text-sm sm:mr-auto" aria-live="polite">
        {count} {noun}
        {count === 1 ? '' : 's'}
        {disabledReason && (
          <span className="block text-xs text-muted-foreground">
            {disabledReason}
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => !busy && onDiscard()}
          aria-disabled={busy || undefined}
        >
          <Undo2Icon aria-hidden />
          Discard
        </Button>
        {/* Busy keeps the button focusable (aria-disabled), so focus can
            return to it when the review dialog closes. */}
        <Button
          variant="cta"
          onClick={() => !busy && onReview()}
          disabled={disabled}
          aria-disabled={busy || undefined}
        >
          {busy ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden />
          ) : (
            <SaveIcon aria-hidden />
          )}
          Review and save
        </Button>
      </div>
    </div>
  );
}
