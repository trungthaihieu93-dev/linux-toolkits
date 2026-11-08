import type { ThemeMode } from '@linux-toolchain/term-config';

/**
 * Monaco takes colours as `#rrggbb` / `#rrggbbaa`, while the tokens in
 * theme.css are hex or `rgb(r g b / a)`. Converts one token value; returns
 * null for anything else.
 */
export function cssColorToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v;
  const rgb =
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/.exec(
      v,
    );
  if (!rgb) return null;
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  let alpha = '';
  if (rgb[4] !== undefined) {
    const a = rgb[4].endsWith('%')
      ? parseFloat(rgb[4]) / 100
      : parseFloat(rgb[4]);
    if (a < 1) alpha = hex(a * 255);
  }
  return `#${hex(+rgb[1])}${hex(+rgb[2])}${hex(+rgb[3])}${alpha}`;
}

/** `#rrggbb` plus an alpha byte (for diff backgrounds derived from tokens). */
const withAlpha = (hex: string, alpha: string) => `${hex.slice(0, 7)}${alpha}`;

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

/** Monaco theme name for an app theme. */
export const monacoThemeName = (mode: ThemeMode) => `td-${mode}`;

/**
 * Monaco theme built from the active theme's tokens, read from `root`
 * (the `.dark` class decides which values the computed style holds). A token
 * that cannot be read is left out, so Monaco's base theme covers it.
 */
export function monacoThemeFromTokens(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): MonacoThemeData {
  const css = getComputedStyle(root);
  const token = (name: string) =>
    cssColorToHex(css.getPropertyValue(`--${name}`));
  const rules: MonacoThemeData['rules'] = [];
  const rule = (name: string, tokenName: string, fontStyle?: string) => {
    const hex = token(tokenName);
    if (hex) {
      rules.push({
        token: name,
        foreground: hex.slice(1, 7),
        ...(fontStyle ? { fontStyle } : {}),
      });
    }
  };
  rule('', 'foreground');
  rule('comment', 'muted-foreground', 'italic');
  rule('string', 'run');
  rule('keyword', 'link');
  rule('number', 'warn');
  rule('variable', 'ansi-magenta');
  rule('variable.predefined', 'ansi-magenta');
  rule('type.identifier', 'warn');
  rule('delimiter', 'muted-foreground');

  const colors: Record<string, string> = {};
  const color = (name: string, tokenName: string, alpha?: string) => {
    const hex = token(tokenName);
    if (hex) colors[name] = alpha ? withAlpha(hex, alpha) : hex;
  };
  color('editor.background', 'card');
  color('editor.foreground', 'foreground');
  color('editorLineNumber.foreground', 'muted-foreground');
  color('editorLineNumber.activeForeground', 'foreground');
  color('editorCursor.foreground', 'term-cursor');
  color('editor.selectionBackground', 'term-selection');
  color('editor.lineHighlightBackground', 'accent', '80');
  color('editorWidget.background', 'popover');
  color('editorWidget.border', 'border');
  color('editorGutter.background', 'card');
  color('diffEditor.insertedTextBackground', 'run', '33');
  color('diffEditor.removedTextBackground', 'destructive', '33');
  color('diffEditor.insertedLineBackground', 'run', '1f');
  color('diffEditor.removedLineBackground', 'destructive', '1f');
  color('focusBorder', 'ring');
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors,
  };
}
