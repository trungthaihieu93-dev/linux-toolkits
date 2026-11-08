import { ConstructionIcon } from 'lucide-react';
import { Link } from '../../app/router';

/**
 * Stand-in for config pages that land later in this build, so navigation
 * keeps working. Each one is replaced by its real page.
 */
export function PendingPage({ title }: { title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <h1 className="font-mono text-xl font-semibold">{title}</h1>
      <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
        <ConstructionIcon
          className="mt-0.5 size-5 shrink-0 text-warn"
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <p className="font-mono text-sm font-medium">Coming in this build</p>
          <p className="text-sm text-muted-foreground">
            The {title} page is not part of this version of td yet. The
            overview, the terminal and the activity panel already work.
          </p>
          <Link
            to="/"
            className="mt-1 w-fit rounded-sm font-mono text-sm text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
