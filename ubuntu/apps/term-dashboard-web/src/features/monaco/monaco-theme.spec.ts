// @vitest-environment jsdom
import { cssColorToHex, monacoThemeFromTokens } from './monaco-theme';

describe('cssColorToHex', () => {
  it('converts the token formats theme.css uses', () => {
    expect(cssColorToHex('#0B0F14')).toBe('#0b0f14');
    expect(cssColorToHex(' #abc ')).toBe('#aabbcc');
    expect(cssColorToHex('rgb(59 130 246 / 0.35)')).toBe('#3b82f659');
    expect(cssColorToHex('rgb(0, 0, 0)')).toBe('#000000');
    expect(cssColorToHex('rgb(15 23 42 / 45%)')).toBe('#0f172a73');
    expect(cssColorToHex('var(--x)')).toBeNull();
    expect(cssColorToHex('')).toBeNull();
  });
});

describe('monacoThemeFromTokens', () => {
  it('reads colours from the CSS tokens and leaves unreadable ones out', () => {
    const root = document.createElement('div');
    root.style.setProperty('--card', '#11161d');
    root.style.setProperty('--foreground', '#e6edf3');
    root.style.setProperty('--run', '#4ade80');
    document.body.append(root);
    const theme = monacoThemeFromTokens('dark', root);
    expect(theme.base).toBe('vs-dark');
    expect(theme.colors['editor.background']).toBe('#11161d');
    expect(theme.colors['diffEditor.insertedTextBackground']).toBe('#4ade8033');
    expect(theme.colors['editor.selectionBackground']).toBeUndefined();
    expect(theme.rules).toContainEqual({
      token: 'string',
      foreground: '4ade80',
    });
    expect(monacoThemeFromTokens('light', root).base).toBe('vs');
    root.remove();
  });
});
