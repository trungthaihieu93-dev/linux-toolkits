import type { ReactNode } from 'react';

/** Title row shared by the config pages. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-mono text-xl font-semibold">{title}</h1>
        {description && (
          <div className="min-w-0 break-words text-sm text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Page body width and padding shared by the config pages. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-5 p-3 sm:p-6">
      {children}
    </div>
  );
}
