import type {
  GhosttyConfigView,
  GhosttyEdit,
  GhosttySaveResult,
  GhosttySchema,
  GhosttySchemaKey,
} from '@linux-toolchain/term-config';
import type { FieldDescriptor, FieldValue } from '../schema-form/types';

/** Section of a key: its first dash-separated word (`font-size` → Font). */
export function ghosttyGroup(key: string): string {
  const head = key.split('-')[0] ?? key;
  return head.charAt(0).toUpperCase() + head.slice(1);
}

/** First sentence of a doc comment, for the always-visible summary. */
export function docSummary(doc: string, max = 180): string {
  const para =
    doc
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';
  const sentence = /^(.+?[.!?])(\s|$)/.exec(para)?.[1] ?? para;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

const isNumberText = (text: string) =>
  text.trim() !== '' && Number.isFinite(Number(text));

export function ghosttyFields(
  schema: GhosttySchema,
  themes: string[],
  fonts: string[],
  /** From `rawNumberKeys`: number keys shown as text. */
  rawNumbers: ReadonlyMap<string, string> = new Map(),
): FieldDescriptor[] {
  return schema.keys.map((k) => {
    const base = {
      id: k.key,
      label: k.key,
      group: ghosttyGroup(k.key),
      summary: k.doc ? docSummary(k.doc) : undefined,
      doc: k.doc || undefined,
    };
    const raw = rawNumbers.get(k.key);
    if (raw !== undefined) {
      // The text from the file stays as it is (the page marks it); an edit
      // must be a number before it can be saved.
      return {
        ...base,
        kind: 'text',
        validate: (v) =>
          String(v) === raw || isNumberText(String(v))
            ? null
            : 'Enter a number.',
      } satisfies FieldDescriptor;
    }
    if (k.repeatable) {
      return {
        ...base,
        kind: 'list',
        options:
          k.control === 'font'
            ? fonts
            : k.control === 'theme'
              ? themes
              : k.values,
        placeholder: k.default || undefined,
      } satisfies FieldDescriptor;
    }
    switch (k.control) {
      case 'bool':
        return { ...base, kind: 'bool' };
      case 'number':
        return { ...base, kind: 'number' };
      case 'color':
        return { ...base, kind: 'color' };
      case 'enum':
        return { ...base, kind: 'enum', options: k.values ?? [] };
      case 'theme':
        // `light:A,dark:B` pairs are valid too, so typed values are allowed.
        return { ...base, kind: 'theme', options: themes, allowCustom: true };
      case 'font':
        return { ...base, kind: 'font', options: fonts, allowCustom: true };
      default:
        return { ...base, kind: 'text', placeholder: k.default || undefined };
    }
  });
}

/**
 * Values each key has in the files, in Ghostty's load order. A path that is
 * the same file as another (a symlink) is read once, through the other id.
 */
export function fileValues(config: GhosttyConfigView): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of config.files) {
    if (file.sameFileAs) continue;
    for (const e of file.entries) {
      const list = out.get(e.key);
      if (list) list.push(e.value);
      else out.set(e.key, [e.value]);
    }
  }
  return out;
}

/** The value a scalar key shows: staged edit, else file, else effective, else default. */
function scalarText(
  k: GhosttySchemaKey,
  config: GhosttyConfigView,
  files: Map<string, string[]>,
  staged: GhosttyEdit | undefined,
): string {
  if (staged?.op === 'set') return staged.value;
  if (staged?.op === 'unset') return k.default;
  return files.get(k.key)?.at(-1) ?? config.effective[k.key]?.[0] ?? k.default;
}

/**
 * Number keys whose current text is not a number (`font-size = big`). They
 * are shown as that text instead of a number box, which would show 0. Maps
 * key to the text.
 */
export function rawNumberKeys(
  schema: GhosttySchema,
  config: GhosttyConfigView,
): Map<string, string> {
  const files = fileValues(config);
  const out = new Map<string, string>();
  for (const k of schema.keys) {
    if (k.repeatable || k.control !== 'number') continue;
    const text = scalarText(k, config, files, undefined);
    // An empty default means "unset"; it is not a value from a file.
    if (!isNumberText(text) && (files.has(k.key) || text !== ''))
      out.set(k.key, text);
  }
  return out;
}

/** What the page shows next to a raw number key that is not edited. */
export function rawNumberErrors(
  raw: ReadonlyMap<string, string>,
  staged: ReadonlyMap<string, GhosttyEdit>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, text] of raw) {
    if (!staged.has(key))
      out[key] = `The config holds “${text}”, which is not a number.`;
  }
  return out;
}

export function toFieldValue(k: GhosttySchemaKey, text: string): FieldValue {
  if (k.control === 'bool') return text === 'true';
  if (k.control === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }
  return text;
}

export function fromFieldValue(value: FieldValue): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Repeatable keys show only what the files set: Ghostty adds file entries to
 * its defaults, so listing the defaults would write them into the file.
 */
function listValues(
  k: GhosttySchemaKey,
  files: Map<string, string[]>,
  staged: GhosttyEdit | undefined,
): string[] {
  if (staged?.op === 'setList') return staged.values;
  if (staged?.op === 'unset') return [];
  return files.get(k.key) ?? [];
}

export interface GhosttyFormState {
  values: Record<string, FieldValue>;
  modified: Set<string>;
}

export function ghosttyFormState(
  schema: GhosttySchema,
  config: GhosttyConfigView,
  staged: ReadonlyMap<string, GhosttyEdit>,
): GhosttyFormState {
  const files = fileValues(config);
  const raw = rawNumberKeys(schema, config);
  const values: Record<string, FieldValue> = {};
  const modified = new Set<string>();
  for (const k of schema.keys) {
    const edit = staged.get(k.key);
    if (k.repeatable) {
      const list = listValues(k, files, edit);
      values[k.key] = list;
      if (list.length > 0) modified.add(k.key);
    } else {
      const text = scalarText(k, config, files, edit);
      values[k.key] = raw.has(k.key) ? text : toFieldValue(k, text);
      // Modified = the files (or a staged edit) set a non-default value; a
      // value that only comes from a theme or include is not.
      const set = edit ? edit.op === 'set' : files.has(k.key);
      if (set && text !== k.default) modified.add(k.key);
    }
  }
  return { values, modified };
}

/**
 * The staged edits after the user changes `key` to `value`; an edit that
 * brings the key back to what the files hold is dropped.
 */
export function stageChange(
  staged: ReadonlyMap<string, GhosttyEdit>,
  k: GhosttySchemaKey,
  value: FieldValue,
  config: GhosttyConfigView,
): Map<string, GhosttyEdit> {
  const next = new Map(staged);
  const inFiles = fileValues(config).get(k.key);
  if (k.repeatable) {
    const values = Array.isArray(value) ? value.map(String) : [];
    if (JSON.stringify(values) === JSON.stringify(inFiles ?? []))
      next.delete(k.key);
    else next.set(k.key, { op: 'setList', key: k.key, values });
    return next;
  }
  const text = fromFieldValue(value);
  const current = inFiles?.at(-1);
  if (current === text || (current === undefined && text === k.default)) {
    next.delete(k.key);
  } else {
    next.set(k.key, { op: 'set', key: k.key, value: text });
  }
  return next;
}

/** Reset to the default: unset when a file sets the key, else drop the edit. */
export function stageReset(
  staged: ReadonlyMap<string, GhosttyEdit>,
  key: string,
  config: GhosttyConfigView,
): Map<string, GhosttyEdit> {
  const next = new Map(staged);
  if (fileValues(config).has(key)) next.set(key, { op: 'unset', key });
  else next.delete(key);
  return next;
}

/** `config` with the mtimes a save returned, for the next save's base. */
export function withSavedMtimes(
  config: GhosttyConfigView,
  result: GhosttySaveResult,
): GhosttyConfigView {
  const mtimes = new Map(result.results.map((r) => [r.fileId, r.mtimeMs]));
  return {
    ...config,
    files: config.files.map((f) => {
      const mtimeMs = mtimes.get(f.id);
      return mtimeMs === undefined ? f : { ...f, mtimeMs, exists: true };
    }),
  };
}
