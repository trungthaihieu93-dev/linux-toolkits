import { readFileSync } from 'node:fs';
import { buttonVariants } from '../components/ui/button';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

/** `--name: #rrggbb` declarations of one block (`:root` or `.dark`). */
function tokens(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return new Map(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rows of the contrast table in the header comment. */
const rows = [
  ...css.matchAll(/^ \*\s+([\w-]+) on ([\w-]+)\s+([\d.]+)\s+([\d.]+)$/gm),
].map((m) => ({
  text: m[1],
  background: m[2],
  dark: Number(m[3]),
  light: Number(m[4]),
}));

describe('theme.css contrast table', () => {
  const modes = { light: tokens(':root'), dark: tokens('.dark') };

  it('lists the primary button hover', () => {
    expect(rows.map((r) => `${r.text} on ${r.background}`)).toContain(
      'primary-foreground on primary-hover',
    );
    expect(buttonVariants({ variant: 'default' })).toContain(
      'hover:bg-primary-hover',
    );
  });

  it.each(rows)(
    '$text on $background matches the tokens and is at least 4.5:1',
    (row) => {
      for (const mode of ['dark', 'light'] as const) {
        const fg = modes[mode].get(row.text);
        const bg = modes[mode].get(row.background);
        expect(fg && bg, `${mode} tokens`).toBeTruthy();
        const ratio = contrast(fg as string, bg as string);
        expect(Math.abs(ratio - row[mode])).toBeLessThan(0.01);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
