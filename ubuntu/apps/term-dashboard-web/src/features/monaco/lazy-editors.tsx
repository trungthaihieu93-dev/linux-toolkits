import { lazy, Suspense } from 'react';
import type { CodeEditorProps, DiffViewerProps } from './monaco-editors';

// Monaco (several MB) loads only when an editor is first shown.
const load = () => import('./monaco-editors');
const CodeEditorImpl = lazy(() =>
  load().then((m) => ({ default: m.CodeEditor })),
);
const DiffViewerImpl = lazy(() =>
  load().then((m) => ({ default: m.DiffViewer })),
);

function Placeholder({ height }: { height: string }) {
  return (
    <div
      role="status"
      style={{ height }}
      className="flex items-center justify-center rounded-md border bg-card font-mono text-sm text-muted-foreground"
    >
      Loading editor…
    </div>
  );
}

export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<Placeholder height={props.height} />}>
      <CodeEditorImpl {...props} />
    </Suspense>
  );
}

export function LazyDiffViewer(props: DiffViewerProps) {
  return (
    <Suspense fallback={<Placeholder height={props.height} />}>
      <DiffViewerImpl {...props} />
    </Suspense>
  );
}
