import {
  formatGVariant,
  parseGVariant,
  type GSettingsKeyView,
  type GVariantValue,
} from '@linux-toolchain/term-config';
import type { FieldDescriptor, FieldValue } from '../schema-form/types';

const NUMERIC = new Set(['y', 'n', 'q', 'i', 'u', 'd']);
const INTEGER_RANGES: Record<string, [number, number]> = {
  y: [0, 0xff],
  n: [-0x8000, 0x7fff],
  q: [0, 0xffff],
  i: [-0x80000000, 0x7fffffff],
  u: [0, 0xffffffff],
};

/** A palette name typed by hand (when the palette list is unavailable). */
export function validatePaletteName(value: FieldValue): string | null {
  const v = String(value);
  if (v.trim() === '') return 'Enter a palette name.';
  if (v.length > 128) return 'Palette names are at most 128 characters.';
  // Control characters and path separators never appear in palette names.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/]/.test(v)) {
    return 'Palette names cannot contain "/" or control characters.';
  }
  return null;
}

export interface GSettingsField {
  field: FieldDescriptor;
  value: FieldValue;
  /** GVariant text for `gsettings set`; throws on an invalid value. */
  encode: (value: FieldValue) => string;
}

function decode(k: GSettingsKeyView): GVariantValue | undefined {
  try {
    return parseGVariant(k.value, k.type);
  } catch {
    return undefined;
  }
}

/**
 * Descriptor, current value and encoder for one gsettings key. Types the
 * form has no control for are edited as GVariant text, which the server
 * validates before calling `gsettings set`.
 */
export function gsettingsField(
  k: GSettingsKeyView,
  opts: { palettes?: string[] | null } = {},
): GSettingsField {
  const base = {
    id: k.name,
    label: k.name,
    summary: k.summary || undefined,
    doc: k.description || undefined,
  };
  const parsed = decode(k);
  const raw = (): GSettingsField => ({
    field: { ...base, kind: 'text', placeholder: k.type },
    value: k.value,
    encode: (v) => String(v),
  });
  if (parsed === undefined) return raw();

  const t = k.type;
  if (t === 'b') {
    return {
      field: { ...base, kind: 'bool' },
      value: parsed === true,
      encode: (v) => formatGVariant(v === true, t),
    };
  }
  if (t === 's' && (k.enum || k.choices)) {
    return {
      field: { ...base, kind: 'enum', options: k.enum ?? k.choices ?? [] },
      value: String(parsed),
      encode: (v) => formatGVariant(String(v), t),
    };
  }
  if (t === 's' && k.name === 'palette' && opts.palettes !== undefined) {
    const names = opts.palettes ?? [];
    return {
      field:
        names.length > 0
          ? { ...base, kind: 'theme', options: names }
          : {
              ...base,
              kind: 'text',
              placeholder: 'Palette name, e.g. Ubuntu',
              validate: validatePaletteName,
            },
      value: String(parsed),
      encode: (v) => formatGVariant(String(v), t),
    };
  }
  if (t === 's') {
    return {
      field: { ...base, kind: 'text' },
      value: String(parsed),
      encode: (v) => formatGVariant(String(v), t),
    };
  }
  if (t === 'ms') {
    return {
      field: { ...base, kind: 'text', placeholder: 'empty = unset' },
      value: parsed === null ? '' : String(parsed),
      encode: (v) => formatGVariant(String(v) === '' ? null : String(v), t),
    };
  }
  if (NUMERIC.has(t)) {
    const integer = t !== 'd';
    const limits = INTEGER_RANGES[t];
    const min = k.range?.min ?? limits?.[0];
    const max = k.range?.max ?? limits?.[1];
    return {
      field: {
        ...base,
        kind: k.range ? 'range' : 'number',
        integer,
        min,
        max,
        step:
          k.range && !integer ? (k.range.max - k.range.min) / 100 : undefined,
      },
      value: Number(parsed),
      encode: (v) => formatGVariant(Number(v), t),
    };
  }
  if (t === 'as') {
    const list = Array.isArray(parsed) ? parsed.map(String) : [];
    return {
      field: k.flags
        ? { ...base, kind: 'multi', options: k.flags }
        : { ...base, kind: 'list' },
      value: list,
      encode: (v) => formatGVariant(Array.isArray(v) ? v.map(String) : [], t),
    };
  }
  if (t === 'a(ss)') {
    const pairs = Array.isArray(parsed)
      ? parsed.map((p): [string, string] =>
          Array.isArray(p) ? [String(p[0]), String(p[1])] : [String(p), ''],
        )
      : [];
    return {
      field: { ...base, kind: 'pairs' },
      value: pairs,
      encode: (v) =>
        formatGVariant(
          Array.isArray(v)
            ? v.map((p) =>
                Array.isArray(p)
                  ? [String(p[0]), String(p[1])]
                  : [String(p), ''],
              )
            : [],
          t,
        ),
    };
  }
  const tuple = /^\(([ynqiud])([ynqiud])\)$/.exec(t);
  if (tuple && Array.isArray(parsed)) {
    const integer = tuple[1] !== 'd' && tuple[2] !== 'd';
    return {
      field: {
        ...base,
        kind: 'tuple',
        integer,
        min: /^[yqu]{2}$/.test(tuple[1] + tuple[2]) ? 0 : undefined,
      },
      value: [Number(parsed[0]), Number(parsed[1])],
      encode: (v) =>
        formatGVariant(Array.isArray(v) ? v.map(Number) : [0, 0], t),
    };
  }
  return raw();
}
