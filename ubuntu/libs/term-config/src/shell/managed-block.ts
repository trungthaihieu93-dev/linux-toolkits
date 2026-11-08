/**
 * Named managed blocks in rc files, in the marker style of
 * `libs/core/src/shell.ts` (`# >>> name >>>` … `# <<< name <<<`).
 *
 * - `term-dashboard`: the main block, appended at the end when missing.
 * - `term-dashboard-omz`: oh-my-zsh theme and plugins. oh-my-zsh reads
 *   `ZSH_THEME` and `plugins` only while `source $ZSH/oh-my-zsh.sh` runs, so
 *   this block must sit immediately above that line.
 *
 * Duplicate or unclosed markers are errors; nothing here guesses.
 */
import { rcBlockEnd, rcBlockStart } from '@linux-toolchain/core/shell';
import type { ManagedBlockName } from '../api';

export const MAIN_BLOCK: ManagedBlockName = 'term-dashboard';
export const OMZ_BLOCK: ManagedBlockName = 'term-dashboard-omz';

export type BlockResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface BlockSpan {
  name: ManagedBlockName;
  /** 0-based line index of the start marker. */
  start: number;
  /** 0-based line index of the end marker. */
  end: number;
  /** Lines between the markers, joined with '\n'. */
  body: string;
}

/** `source $ZSH/oh-my-zsh.sh` and its common spellings. */
const OMZ_SOURCE =
  /^\s*(source|\.)\s+("\$\{?ZSH\}?\/oh-my-zsh\.sh"|\$\{?ZSH\}?\/oh-my-zsh\.sh)\s*(#.*)?$/;

export function isOhMyZshSourceLine(line: string): boolean {
  return OMZ_SOURCE.test(line);
}

function splitLines(text: string): string[] {
  return text.split('\n');
}

/** Find a block. `value` is null when the file has no block of that name. */
export function findBlock(
  text: string,
  name: ManagedBlockName,
): BlockResult<BlockSpan | null> {
  const lines = splitLines(text);
  const startMarker = rcBlockStart(name);
  const endMarker = rcBlockEnd(name);
  const starts: number[] = [];
  const ends: number[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t === startMarker) starts.push(i);
    else if (t === endMarker) ends.push(i);
  });
  if (starts.length === 0 && ends.length === 0)
    return { ok: true, value: null };
  if (starts.length > 1 || ends.length > 1) {
    return {
      ok: false,
      error: `duplicate "${name}" block markers (lines ${[...starts, ...ends]
        .sort((a, b) => a - b)
        .map((i) => i + 1)
        .join(', ')}); fix the file in the editor`,
    };
  }
  if (starts.length === 0 || ends.length === 0 || ends[0] < starts[0]) {
    const line = (starts[0] ?? ends[0]) + 1;
    return {
      ok: false,
      error: `unclosed "${name}" block near line ${line}; fix the file in the editor`,
    };
  }
  const [start] = starts;
  const [end] = ends;
  return {
    ok: true,
    value: { name, start, end, body: lines.slice(start + 1, end).join('\n') },
  };
}

/** 0-based indices of `source $ZSH/oh-my-zsh.sh` lines outside td blocks. */
export function ohMyZshSourceLines(text: string): number[] {
  const lines = splitLines(text);
  const skip = new Set<number>();
  for (const name of [MAIN_BLOCK, OMZ_BLOCK]) {
    const found = findBlock(text, name);
    if (found.ok && found.value) {
      for (let i = found.value.start; i <= found.value.end; i++) skip.add(i);
    }
  }
  return lines.flatMap((line, i) =>
    !skip.has(i) && isOhMyZshSourceLine(line) ? [i] : [],
  );
}

function blockLines(name: ManagedBlockName, body: string): string[] {
  const inner = body === '' ? [] : body.replace(/\n+$/, '').split('\n');
  return [rcBlockStart(name), ...inner, rcBlockEnd(name)];
}

/**
 * Set (or with `body === null` remove) the main block. A new block goes at
 * the end of the file after one blank line.
 */
export function setMainBlock(
  text: string,
  body: string | null,
): BlockResult<string> {
  const found = findBlock(text, MAIN_BLOCK);
  if (!found.ok) return found;
  const lines = splitLines(text);
  const span = found.value;
  if (span) {
    if (body === null) {
      let from = span.start;
      // Drop the blank separator this module added above the block.
      if (from > 0 && lines[from - 1].trim() === '') from--;
      lines.splice(from, span.end - from + 1);
    } else {
      lines.splice(
        span.start,
        span.end - span.start + 1,
        ...blockLines(MAIN_BLOCK, body),
      );
    }
    return { ok: true, value: lines.join('\n') };
  }
  if (body === null) return { ok: true, value: text };
  const block = blockLines(MAIN_BLOCK, body).join('\n');
  if (text === '') return { ok: true, value: `${block}\n` };
  const base = text.endsWith('\n') ? text : `${text}\n`;
  const sep = base.endsWith('\n\n') ? '' : '\n';
  return { ok: true, value: `${base}${sep}${block}\n` };
}

/** Why theme/plugin editing is unavailable, or null when it is available. */
export function ohMyZshDisabledReason(text: string): string | null {
  const count = ohMyZshSourceLines(text).length;
  if (count === 0) {
    return 'no "source $ZSH/oh-my-zsh.sh" line, so oh-my-zsh theme and plugins cannot be set';
  }
  if (count > 1) {
    return `"source $ZSH/oh-my-zsh.sh" appears ${count} times; keep exactly one to edit theme and plugins`;
  }
  return null;
}

/**
 * Set (or with `body === null` remove) the oh-my-zsh block so it sits
 * directly above the single `source $ZSH/oh-my-zsh.sh` line. An existing
 * block elsewhere is moved there.
 */
export function setOmzBlock(
  text: string,
  body: string | null,
): BlockResult<string> {
  const found = findBlock(text, OMZ_BLOCK);
  if (!found.ok) return found;
  const lines = splitLines(text);
  const span = found.value;
  if (body === null) {
    if (span) lines.splice(span.start, span.end - span.start + 1);
    return { ok: true, value: lines.join('\n') };
  }
  const reason = ohMyZshDisabledReason(text);
  if (reason !== null) return { ok: false, error: reason };
  let at = ohMyZshSourceLines(text)[0];
  if (span) {
    lines.splice(span.start, span.end - span.start + 1);
    if (span.end < at) at -= span.end - span.start + 1;
  }
  lines.splice(at, 0, ...blockLines(OMZ_BLOCK, body));
  return { ok: true, value: lines.join('\n') };
}
