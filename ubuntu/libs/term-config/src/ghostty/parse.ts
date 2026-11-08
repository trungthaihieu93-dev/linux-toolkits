/**
 * Line model of a Ghostty config file. It keeps every line (comments,
 * blanks, `config-file` includes, repeated keys such as `keybind`, `palette`
 * and `font-family`) in order, so editing a key leaves the rest untouched.
 * The same parser reads `ghostty +show-config` output.
 */
import type { GhosttyConflict, GhosttyFileId } from '../api';

export type GhosttyLine =
  | { kind: 'comment' | 'blank' | 'invalid'; raw: string }
  | { kind: 'entry'; key: string; value: string; raw: string };

export type GhosttyEntry = Extract<GhosttyLine, { kind: 'entry' }>;

export interface GhosttyDoc {
  lines: GhosttyLine[];
  /** Text this doc was parsed from; serialize returns it while `dirty` is false. */
  readonly original: string;
  dirty: boolean;
  /** Line ending of the original text. */
  readonly eol: '\n' | '\r\n';
  /** The original text ended with a line ending (or was empty). */
  readonly finalNewline: boolean;
}

export class GhosttyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhosttyConfigError';
  }
}

/** Ghostty key syntax. */
export const GHOSTTY_KEY_RE = /^[a-z][a-z0-9-]*$/;

function parseLine(raw: string): GhosttyLine {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'blank', raw };
  if (trimmed.startsWith('#')) return { kind: 'comment', raw };
  const eq = trimmed.indexOf('=');
  const key = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim();
  if (!GHOSTTY_KEY_RE.test(key)) return { kind: 'invalid', raw };
  const value = eq === -1 ? '' : trimmed.slice(eq + 1).trim();
  return { kind: 'entry', key, value, raw };
}

export function parseGhostty(text: string): GhosttyDoc {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = text === '' || text.endsWith('\n');
  const body = finalNewline && text !== '' ? text.slice(0, -eol.length) : text;
  const lines = text === '' ? [] : body.split(eol).map(parseLine);
  return { lines, original: text, dirty: false, eol, finalNewline };
}

export function entries(doc: GhosttyDoc): GhosttyEntry[] {
  return doc.lines.filter((l): l is GhosttyEntry => l.kind === 'entry');
}

/** Values of `key` in file order (several for repeatable keys). */
export function getValues(doc: GhosttyDoc, key: string): string[] {
  return entries(doc)
    .filter((e) => e.key === key)
    .map((e) => e.value);
}

export interface GhosttyInclude {
  path: string;
  optional: boolean;
  /** 1-based. */
  line: number;
}

/** `config-file` includes, in order. A leading `?` marks an optional file. */
export function includes(doc: GhosttyDoc): GhosttyInclude[] {
  const out: GhosttyInclude[] = [];
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'entry' || l.key !== 'config-file' || l.value === '') return;
    let path = unquote(l.value);
    const optional = path.startsWith('?');
    if (optional) path = unquote(path.slice(1));
    out.push({ path, optional, line: i + 1 });
  });
  return out;
}

/** Strip one pair of surrounding double quotes, as Ghostty does. */
export function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/** Key to values, for `+show-config` output or a single file. */
export function valuesByKey(doc: GhosttyDoc): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of entries(doc)) (out[e.key] ??= []).push(e.value);
  return out;
}

/**
 * Keys that more than one file sets. `files` must be in load order; the last
 * file that sets a key wins. Repeatable keys accumulate across files instead
 * of conflicting, so pass `isRepeatable` to skip them.
 */
export function findConflicts(
  files: readonly { id: GhosttyFileId; doc: GhosttyDoc }[],
  isRepeatable: (key: string) => boolean = () => false,
): GhosttyConflict[] {
  const setters = new Map<string, GhosttyFileId[]>();
  for (const { id, doc } of files) {
    for (const key of new Set(entries(doc).map((e) => e.key))) {
      if (key === 'config-file' || isRepeatable(key)) continue;
      const list = setters.get(key) ?? [];
      list.push(id);
      setters.set(key, list);
    }
  }
  const out: GhosttyConflict[] = [];
  for (const [key, ids] of setters) {
    if (ids.length > 1)
      out.push({ key, files: ids, winner: ids[ids.length - 1] });
  }
  return out;
}
