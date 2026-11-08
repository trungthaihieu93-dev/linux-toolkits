/**
 * Schema from `ghostty +show-config --default --docs`: each key's doc
 * comment, default value(s), whether it repeats, and the form control the UI
 * should render. Keys listed right after a documented key without their own
 * doc (e.g. `font-family-bold` after `font-family`) share that doc.
 */
import type { GhosttyControl, GhosttySchema, GhosttySchemaKey } from '../api';
import { entries, parseGhostty } from './parse';

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
/** "This (configuration) can be repeated", not "Units can be repeated". */
const REPEAT_DOC =
  /\b(this(?: configuration)?|it) (can|may) be (repeated|specified multiple times|set multiple times)/i;
const COLOR_KEY = /(^|-)(colou?r|foreground|background)$/;
const FONT_KEY = /(^|-)font-family(-|$)/;

/**
 * Allowed values from the standard "Valid values" bullet list: bullets whose
 * first token is a backtick-quoted value. Returns undefined when the doc has
 * no such list.
 */
export function validValues(doc: string): string[] | undefined {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => /valid values\b/i.test(l));
  if (start === -1) return undefined;
  const values: string[] = [];
  let inList = false;
  for (const line of lines.slice(start + 1)) {
    const bullet = /^\s*[*-]\s+`([^`]*)`/.exec(line);
    if (bullet) {
      values.push(bullet[1].trim());
      inList = true;
      continue;
    }
    const blank = line.trim() === '';
    const continuation = /^\s{2,}\S/.test(line) && !/^\s*[*-]\s/.test(line);
    if (blank || (inList && continuation)) continue;
    // Any other line ends the list (or, before it starts, means no list).
    break;
  }
  return values.length >= 2 ? [...new Set(values)] : undefined;
}

function inferControl(
  key: string,
  doc: string,
  def: string,
  values: string[] | undefined,
): GhosttyControl {
  if (key === 'theme') return 'theme';
  if (FONT_KEY.test(key)) return 'font';
  const boolValues =
    !values || values.every((v) => v === 'true' || v === 'false');
  if ((def === 'true' || def === 'false') && boolValues) return 'bool';
  // Flag lists such as `bell-features` have defaults outside the list.
  if (values && (def === '' || values.includes(def))) return 'enum';
  if (HEX_COLOR.test(def)) return 'color';
  if (def === '' && COLOR_KEY.test(key) && /\bcolou?r\b/i.test(doc))
    return 'color';
  if (NUMBER.test(def)) return 'number';
  return 'text';
}

export function parseGhosttySchema(
  text: string,
  version: string | null = null,
): GhosttySchema {
  const doc = parseGhostty(text);
  const order: string[] = [];
  const byKey = new Map<string, { doc: string; defaults: string[] }>();
  let pending: string[] = [];
  let lastDoc = '';
  for (const line of doc.lines) {
    if (line.kind === 'comment') {
      pending.push(line.raw.replace(/^\s*# ?/, ''));
      continue;
    }
    if (line.kind !== 'entry') continue;
    if (pending.length > 0) {
      lastDoc = pending.join('\n').trimEnd();
      pending = [];
    }
    let info = byKey.get(line.key);
    if (!info) {
      info = { doc: lastDoc, defaults: [] };
      byKey.set(line.key, info);
      order.push(line.key);
    }
    info.defaults.push(line.value);
  }
  const keys = order.map((key): GhosttySchemaKey => {
    const { doc: keyDoc, defaults } = byKey.get(key) as {
      doc: string;
      defaults: string[];
    };
    const def = defaults[0] ?? '';
    const values = validValues(keyDoc);
    const control = inferControl(key, keyDoc, def, values);
    const out: GhosttySchemaKey = {
      key,
      doc: keyDoc,
      default: def,
      defaults,
      repeatable: defaults.length > 1 || REPEAT_DOC.test(keyDoc),
      control,
    };
    if (control === 'enum' && values) out.values = values;
    return out;
  });
  return { version, keys };
}

/** Number of key lines in the dump (repeated keys counted each time). */
export function countDefaultLines(text: string): number {
  return entries(parseGhostty(text)).length;
}
