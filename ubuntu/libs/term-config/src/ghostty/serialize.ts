/**
 * Edits on the Ghostty line model and serialization. Untouched docs
 * serialize to their original text byte for byte.
 */
import {
  getValues,
  GHOSTTY_KEY_RE,
  GhosttyConfigError,
  type GhosttyDoc,
  type GhosttyEntry,
  type GhosttyLine,
} from './parse';

export function serializeGhostty(doc: GhosttyDoc): string {
  if (!doc.dirty) return doc.original;
  if (doc.lines.length === 0) return '';
  const text = doc.lines.map((l) => l.raw).join(doc.eol);
  // A file td wrote to always ends with a newline.
  return `${text}${doc.eol}`;
}

function checkKey(key: string): void {
  if (!GHOSTTY_KEY_RE.test(key)) {
    throw new GhosttyConfigError(`invalid Ghostty key ${JSON.stringify(key)}`);
  }
}

function checkValue(value: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new GhosttyConfigError('Ghostty values cannot contain line breaks');
  }
}

function entryLine(key: string, value: string): GhosttyEntry {
  const v = value.trim();
  return {
    kind: 'entry',
    key,
    value: v,
    raw: v === '' ? `${key} =` : `${key} = ${v}`,
  };
}

/** Append a line after the last non-blank line. */
function append(doc: GhosttyDoc, line: GhosttyLine): void {
  let at = doc.lines.length;
  while (at > 0 && doc.lines[at - 1].kind === 'blank') at--;
  doc.lines.splice(at, 0, line);
}

/**
 * Set a single-valued key. The last occurrence (the one Ghostty uses) is
 * rewritten in place; a missing key is appended.
 */
export function setValue(doc: GhosttyDoc, key: string, value: string): void {
  checkKey(key);
  checkValue(value);
  const line = entryLine(key, value);
  for (let i = doc.lines.length - 1; i >= 0; i--) {
    const l = doc.lines[i];
    if (l.kind === 'entry' && l.key === key) {
      if (l.value === line.value) return;
      doc.lines[i] = line;
      doc.dirty = true;
      return;
    }
  }
  append(doc, line);
  doc.dirty = true;
}

/**
 * Replace every occurrence of a repeatable key with `values`, placed where
 * the first occurrence was (appended when the key is new). An empty list
 * removes the key.
 */
export function setList(
  doc: GhosttyDoc,
  key: string,
  values: readonly string[],
): void {
  checkKey(key);
  values.forEach(checkValue);
  const current = getValues(doc, key);
  const next = values.map((v) => v.trim());
  if (
    current.length === next.length &&
    current.every((v, i) => v === next[i])
  ) {
    return;
  }
  const first = doc.lines.findIndex((l) => l.kind === 'entry' && l.key === key);
  const kept = doc.lines.filter((l) => !(l.kind === 'entry' && l.key === key));
  const fresh = next.map((v) => entryLine(key, v));
  if (first === -1) {
    doc.lines = kept;
    for (const line of fresh) append(doc, line);
  } else {
    const before = doc.lines
      .slice(0, first)
      .filter((l) => !(l.kind === 'entry' && l.key === key)).length;
    kept.splice(before, 0, ...fresh);
    doc.lines = kept;
  }
  doc.dirty = true;
}

/** Remove every occurrence of `key`. */
export function unset(doc: GhosttyDoc, key: string): void {
  checkKey(key);
  const kept = doc.lines.filter((l) => !(l.kind === 'entry' && l.key === key));
  if (kept.length !== doc.lines.length) {
    doc.lines = kept;
    doc.dirty = true;
  }
}
