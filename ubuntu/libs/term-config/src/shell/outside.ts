/**
 * Read-only summary of the rc lines outside td's managed blocks that the
 * blocks may override or be overridden by: aliases, exports, PATH,
 * `ZSH_THEME=`, `plugins=(...)` and `source` lines. Config mode shows it so
 * users see what is defined elsewhere.
 */
import type { OutsideLine, OutsideLineKind } from '../api';
import { findBlock, MAIN_BLOCK, OMZ_BLOCK } from './managed-block';

const RULES: [OutsideLineKind, RegExp][] = [
  ['alias', /^alias\s+(?:-[a-zA-Z]+\s+)*([^=\s]+)=/],
  ['path', /^(?:export\s+)?(PATH)[+]?=/],
  ['export', /^export\s+(?:-[a-zA-Z]+\s+)*([A-Za-z_][A-Za-z0-9_]*)(?:=|\s|$)/],
  ['zsh-theme', /^(ZSH_THEME)=/],
  ['plugins', /^(plugins)=\(/],
  ['source', /^(?:source|\.)\s+(\S+)/],
];

export function summarizeOutside(text: string): OutsideLine[] {
  const lines = text.split('\n');
  const inside = new Set<number>();
  for (const name of [MAIN_BLOCK, OMZ_BLOCK]) {
    const found = findBlock(text, name);
    if (found.ok && found.value) {
      for (let i = found.value.start; i <= found.value.end; i++) inside.add(i);
    }
  }
  const out: OutsideLine[] = [];
  lines.forEach((raw, i) => {
    if (inside.has(i)) return;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    for (const [kind, re] of RULES) {
      const m = re.exec(line);
      if (m) {
        out.push({ line: i + 1, kind, name: m[1] ?? null, text: raw });
        return;
      }
    }
  });
  return out;
}
