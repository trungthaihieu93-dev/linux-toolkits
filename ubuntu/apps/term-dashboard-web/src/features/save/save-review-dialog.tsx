import type { CheckResult, SavePreview } from '@linux-toolchain/term-config';
import {
  ArchiveIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { LazyDiffViewer } from '../monaco/lazy-editors';
import { backupNote, originalFromPreview } from './preview-text';

export interface SaveReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** One entry per file the save writes. */
  previews: SavePreview[];
  warnings?: string[];
  /** The save request is running. */
  busy?: boolean;
  /** Why the last Apply failed (shown in the dialog). */
  error?: string | null;
  applyLabel?: string;
  /** Monaco language of the files. */
  language?: string;
  onApply: () => void;
}

/** True when every check passed (or was skipped because its tool is missing). */
export const checksPass = (previews: SavePreview[]) =>
  previews.every((p) => p.check.ok);

function CheckOutput({ check }: { check: CheckResult }) {
  const command = check.argv.join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Check
        </span>
        {check.skipped ? (
          <Badge variant="warn">skipped</Badge>
        ) : check.ok ? (
          <Badge variant="run">
            <CircleCheckIcon aria-hidden />
            passed
          </Badge>
        ) : (
          <Badge variant="destructive">
            <CircleAlertIcon aria-hidden />
            failed
          </Badge>
        )}
        {command && (
          <code className="min-w-0 break-all font-mono text-xs text-muted-foreground">
            {command}
          </code>
        )}
      </div>
      {check.skipped && (
        <p className="text-sm text-muted-foreground">{check.skipped}</p>
      )}
      {check.output.trim() && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-2 font-mono text-xs">
          {check.output.trim()}
        </pre>
      )}
    </div>
  );
}

function PreviewSection({
  preview,
  height,
  language,
}: {
  preview: SavePreview;
  height: string;
  language: string;
}) {
  const original = originalFromPreview(preview);
  return (
    <section
      aria-label={preview.path}
      className="flex min-w-0 flex-col gap-3 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-all font-mono text-sm font-medium">
          {preview.path}
        </h3>
        {!preview.changed && <Badge variant="muted">no changes</Badge>}
        {preview.baseMtimeMs === null && (
          <Badge variant="outline">new file</Badge>
        )}
      </div>
      {preview.changed &&
        (original !== null ? (
          <LazyDiffViewer
            original={original}
            modified={preview.candidate}
            language={language}
            height={height}
            ariaLabel={`Changes to ${preview.path}`}
          />
        ) : (
          <pre className="max-h-[45vh] overflow-auto rounded-md border bg-card p-2 font-mono text-xs">
            {preview.diff}
          </pre>
        ))}
      <CheckOutput check={preview.check} />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ArchiveIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{backupNote(preview)}</span>
      </p>
    </section>
  );
}

/**
 * The confirmation every file write goes through: the diff (Monaco, read
 * only), the syntax check output, where the backup goes, and Apply. Apply
 * stays disabled while a check fails or nothing would change.
 */
export function SaveReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  previews,
  warnings = [],
  busy = false,
  error,
  applyLabel = 'Apply',
  language = 'shell',
  onApply,
}: SaveReviewDialogProps) {
  const pass = checksPass(previews);
  const changed = previews.some((p) => p.changed);
  const blockedReason = !pass
    ? 'The syntax check failed. Fix the errors before saving.'
    : !changed
      ? 'Nothing would change.'
      : null;
  const height = previews.length > 1 ? '30vh' : '45vh';

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              'Review the changes. Nothing is written until you apply them.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {previews.map((p) => (
            <PreviewSection
              key={p.fileId}
              preview={p}
              height={height}
              language={language}
            />
          ))}
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-warn/40 p-3">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 text-sm">
                  <TriangleAlertIcon
                    className="mt-0.5 size-4 shrink-0 text-warn"
                    aria-hidden
                  />
                  <span className="min-w-0 break-words">{w}</span>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <div
              role="alert"
              className="whitespace-pre-wrap break-words rounded-md border border-destructive/50 p-3 font-mono text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="items-stretch sm:items-center">
          {blockedReason && (
            <p
              id="save-blocked-reason"
              className="text-sm text-muted-foreground sm:mr-auto"
            >
              {blockedReason}
            </p>
          )}
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="cta"
            disabled={busy || blockedReason !== null}
            aria-describedby={blockedReason ? 'save-blocked-reason' : undefined}
            onClick={onApply}
          >
            {busy && <LoaderCircleIcon className="animate-spin" aria-hidden />}
            {applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
