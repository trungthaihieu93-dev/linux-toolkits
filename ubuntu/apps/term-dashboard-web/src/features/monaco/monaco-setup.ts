/**
 * Monaco from the local `monaco-editor` package (never a CDN): the editor
 * API, the editor contributions (find, folding, diff editor, ...), the shell
 * language only, and the editor worker bundled by Vite. Language workers
 * (TypeScript, JSON, CSS, HTML) are not included.
 *
 * Imported only by the lazy editor chunk, so the main bundle stays small.
 */
import { loader } from '@monaco-editor/react';
import type { ThemeMode } from '@linux-toolchain/term-config';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/shell/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { monacoThemeFromTokens, monacoThemeName } from './monaco-theme';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// @monaco-editor/loader types its `monaco` option against a module path
// that this monaco-editor version does not export; the namespace is the
// same API object.
loader.config({
  monaco: monaco as Parameters<typeof loader.config>[0]['monaco'],
});

export { monaco };

/** (Re)define the td theme for `mode` from the current tokens and apply it. */
export function applyMonacoTheme(mode: ThemeMode): string {
  const name = monacoThemeName(mode);
  monaco.editor.defineTheme(name, monacoThemeFromTokens(mode));
  monaco.editor.setTheme(name);
  return name;
}
