/**
 * Reader for `*.gschema.xml` / `*.enums.xml` text. The format is small and
 * regular, so plain string scanning is enough (no XML dependency). Metadata
 * comes from here; values and effective defaults come from
 * `gsettings list-recursively` (see gsettings-list.ts), because vendor
 * overrides change the XML defaults.
 */
import type {
  GSettingsKeyView,
  GSettingsRange,
  GSettingsSchemaView,
} from './api';
import { canonicalGVariant } from './gvariant';

export interface GSchemaKey {
  name: string;
  /** GVariant type; `s` for enum keys, `as` for flags keys. */
  type: string;
  enum?: string[];
  flags?: string[];
  range?: GSettingsRange;
  choices?: string[];
  summary: string;
  description: string;
  /** XML default, GVariant text (before vendor overrides). */
  default: string;
}

export interface GSchema {
  schemaId: string;
  /** Absent for relocatable schemas. */
  path?: string;
  keys: GSchemaKey[];
}

export class GSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GSchemaError';
  }
}

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g,
    (whole, ref: string) => {
      if (ref.startsWith('#x'))
        return String.fromCodePoint(parseInt(ref.slice(2), 16));
      if (ref.startsWith('#'))
        return String.fromCodePoint(parseInt(ref.slice(1), 10));
      return ENTITIES[ref] ?? whole;
    },
  );
}

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(
    /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g,
  )) {
    out[m[1]] = decode(m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Text content of the first `<tag>` element in `body`, or undefined. */
function element(body: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? decode(m[1]) : undefined;
}

const collapse = (text: string | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').trim();

function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** Enum and flags definitions: id to the nicks in declaration order. */
function readEnums(
  xml: string,
): Map<string, { flags: boolean; nicks: string[] }> {
  const out = new Map<string, { flags: boolean; nicks: string[] }>();
  for (const m of xml.matchAll(/<(enum|flags)\s([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const id = attrs(m[2])['id'];
    if (!id) throw new GSchemaError(`<${m[1]}> without an id`);
    const nicks = [...m[3].matchAll(/<value\s([^>]*?)\/?>/g)].map((v) => {
      const nick = attrs(v[1])['nick'];
      if (nick === undefined)
        throw new GSchemaError(`value without nick in ${id}`);
      return nick;
    });
    out.set(id, { flags: m[1] === 'flags', nicks });
  }
  return out;
}

function readKey(
  attrText: string,
  body: string,
  schemaId: string,
  enums: Map<string, { flags: boolean; nicks: string[] }>,
): GSchemaKey {
  const a = attrs(attrText);
  const name = a['name'];
  if (!name) throw new GSchemaError(`key without a name in ${schemaId}`);
  const where = `${schemaId}.${name}`;
  const key: GSchemaKey = {
    name,
    type: '',
    summary: collapse(element(body, 'summary')),
    description: collapse(element(body, 'description')),
    default: (element(body, 'default') ?? '').trim(),
  };
  if (a['type']) key.type = a['type'];
  else if (a['enum'] || a['flags']) {
    const ref = a['enum'] ?? a['flags'];
    const def = enums.get(ref);
    if (!def) throw new GSchemaError(`${where}: unknown enum "${ref}"`);
    if (a['enum']) {
      key.type = 's';
      key.enum = def.nicks;
    } else {
      key.type = 'as';
      key.flags = def.nicks;
    }
  } else throw new GSchemaError(`${where}: key has no type`);
  if (element(body, 'default') === undefined) {
    throw new GSchemaError(`${where}: key has no default`);
  }
  const range = /<range\s([^>]*?)\/?>/.exec(body);
  if (range) {
    const r = attrs(range[1]);
    const min = Number(r['min']);
    const max = Number(r['max']);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new GSchemaError(`${where}: bad range`);
    }
    key.range = { min, max };
  }
  const choices = /<choices>([\s\S]*?)<\/choices>/.exec(body);
  if (choices) {
    key.choices = [...choices[1].matchAll(/<choice\s([^>]*?)\/?>/g)].map(
      (c) => attrs(c[1])['value'] ?? '',
    );
  }
  return key;
}

/**
 * Parse schema XML texts together, so enums defined in one file (for example
 * `org.gnome.Terminal.enums.xml`) resolve keys in another.
 */
export function parseGSchemaFiles(texts: readonly string[]): GSchema[] {
  const cleaned = texts.map(stripComments);
  const enums = new Map<string, { flags: boolean; nicks: string[] }>();
  for (const xml of cleaned) {
    for (const [id, def] of readEnums(xml)) enums.set(id, def);
  }
  const schemas: GSchema[] = [];
  for (const xml of cleaned) {
    for (const m of xml.matchAll(/<schema\s([^>]*?)>([\s\S]*?)<\/schema>/g)) {
      const a = attrs(m[1]);
      const schemaId = a['id'];
      if (!schemaId) throw new GSchemaError('<schema> without an id');
      const keys = [...m[2].matchAll(/<key\s([^>]*?)>([\s\S]*?)<\/key>/g)].map(
        (k) => readKey(k[1], k[2], schemaId, enums),
      );
      const schema: GSchema = { schemaId, keys };
      if (a['path']) schema.path = a['path'];
      schemas.push(schema);
    }
  }
  return schemas;
}

/** Single-file convenience for `parseGSchemaFiles`. */
export function parseGSchema(text: string): GSchema[] {
  return parseGSchemaFiles([text]);
}

/**
 * Join schema metadata with values and effective defaults (both key to
 * GVariant text, from `gsettings list-recursively`). Keys missing from
 * `defaults` fall back to the XML default; keys missing from `values` use
 * the default.
 */
export function buildSchemaView(
  schema: GSchema,
  values: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, string>>,
  path: string | null = schema.path ?? null,
): GSettingsSchemaView {
  const keys = schema.keys.map((k): GSettingsKeyView => {
    const def = defaults[k.name] ?? k.default;
    const value = values[k.name] ?? def;
    const a = canonicalGVariant(value, k.type);
    const b = canonicalGVariant(def, k.type);
    const view: GSettingsKeyView = {
      name: k.name,
      type: k.type,
      summary: k.summary,
      description: k.description,
      value,
      default: def,
      isDefault: a !== null && b !== null ? a === b : value === def,
    };
    if (k.enum) view.enum = k.enum;
    if (k.flags) view.flags = k.flags;
    if (k.range) view.range = k.range;
    if (k.choices) view.choices = k.choices;
    return view;
  });
  return { schema: schema.schemaId, path, keys };
}
