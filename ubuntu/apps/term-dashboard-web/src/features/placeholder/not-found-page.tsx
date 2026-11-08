import { StatePanel } from '../../components/state-panel';
import { Link } from '../../app/router';

export function NotFoundPage({ path }: { path: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3 sm:p-6">
      <h1 className="font-mono text-xl font-semibold">Page not found</h1>
      <StatePanel
        tone="empty"
        title={`No page at ${path}`}
        action={
          <Link
            to="/"
            className="rounded-sm font-mono text-sm text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Go to overview
          </Link>
        }
      />
    </div>
  );
}
