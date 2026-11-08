import { DiffEditor, Editor, type OnMount } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../lib/theme';
import { applyMonacoTheme, monaco } from './monaco-setup';
import { monacoThemeName } from './monaco-theme';

/** Same stack as `--font-mono` in global.css (self-hosted JetBrains Mono). */
const EDITOR_FONT =
  "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', monospace";

const BASE_OPTIONS = {
  fontFamily: EDITOR_FONT,
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderWhitespace: 'selection',
  // No outbound requests: links open nothing and there is no telemetry.
  links: false,
} satisfies monaco.editor.IEditorOptions;

/** Keeps the Monaco theme in step with the app theme. */
function useMonacoTheme() {
  const { theme } = useTheme();
  useEffect(() => {
    applyMonacoTheme(theme);
  }, [theme]);
  return {
    themeName: monacoThemeName(theme),
    beforeMount: () => {
      applyMonacoTheme(theme);
    },
  };
}

const BOM = '\uFEFF';

const loadingText = (
  <span className="font-mono text-sm text-muted-foreground">
    Loading editor…
  </span>
);

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  language?: string;
  /** CSS height, e.g. `60vh`. */
  height: string;
  ariaLabel: string;
  /** Scroll to and place the cursor on this 1-based line; change `nonce` to repeat. */
  reveal?: { line: number; nonce: number } | null;
}

/** A Monaco editor for one file. */
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  language = 'shell',
  height,
  ariaLabel,
  reveal,
}: CodeEditorProps) {
  const { themeName, beforeMount } = useMonacoTheme();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [mounted, setMounted] = useState(false);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    setMounted(true);
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!mounted || !editor || !reveal) return;
    editor.revealLineInCenter(reveal.line);
    editor.setPosition({ lineNumber: reveal.line, column: 1 });
    editor.focus();
  }, [mounted, reveal]);

  // Monaco drops a leading BOM from its text, and @monaco-editor/react
  // re-applies a `value` that differs from that text as a literal edit. So
  // the editor gets the text without the BOM, and an edited value gets it
  // back, so a raw-mode save keeps it (the review diff, also Monaco, would
  // not show it missing).
  const bom = value.startsWith(BOM) ? BOM : '';

  return (
    <Editor
      height={height}
      language={language}
      value={bom ? value.slice(1) : value}
      theme={themeName}
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(v) => onChange?.(bom + (v ?? ''))}
      loading={loadingText}
      options={{
        ...BASE_OPTIONS,
        readOnly,
        ariaLabel,
        tabFocusMode: readOnly,
      }}
    />
  );
}

/** True at the width where the diff shows side by side (lg breakpoint). */
function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export interface DiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  height: string;
  ariaLabel: string;
}

/** Read-only Monaco diff: side by side from 1024 px, inline below. */
export function DiffViewer({
  original,
  modified,
  language = 'shell',
  height,
  ariaLabel,
}: DiffViewerProps) {
  const { themeName, beforeMount } = useMonacoTheme();
  const wide = useWide();
  return (
    <DiffEditor
      height={height}
      language={language}
      original={original}
      modified={modified}
      theme={themeName}
      beforeMount={beforeMount}
      loading={loadingText}
      options={{
        ...BASE_OPTIONS,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: wide,
        useInlineViewWhenSpaceIsLimited: false,
        ariaLabel,
        originalAriaLabel: `${ariaLabel}: current file`,
        modifiedAriaLabel: `${ariaLabel}: after saving`,
        tabFocusMode: true,
      }}
    />
  );
}
