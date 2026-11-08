/**
 * Field descriptors for schema-driven forms. Adapters turn Ghostty schema
 * keys, gsettings keys and the shell model into descriptors; SchemaField
 * renders one control per descriptor.
 */
export type FieldKind =
  | 'bool'
  | 'enum'
  | 'range'
  | 'number'
  | 'color'
  | 'list'
  | 'multi'
  | 'pairs'
  | 'tuple'
  | 'theme'
  | 'font'
  | 'text';

/**
 * Value shape per kind: `bool` boolean; `range`/`number` number; `list`/
 * `multi` string[]; `pairs` [string, string][]; `tuple` [number, number];
 * everything else string.
 */
export type FieldValue =
  | boolean
  | number
  | string
  | string[]
  | [string, string][]
  | [number, number];

export interface FieldDescriptor {
  /** Stable key (setting name). */
  id: string;
  label: string;
  /** Section heading in SchemaForm. */
  group?: string;
  /** One-line description, always visible. */
  summary?: string;
  /** Long help, shown on demand. */
  doc?: string;
  kind: FieldKind;
  /** Choices for enum, multi, theme, font, or suggestions for list rows. */
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** Labels of the two `tuple` inputs and the two `pairs` columns. */
  partLabels?: [string, string];
  placeholder?: string;
  /** theme/font: accept a value that is not in `options`. */
  allowCustom?: boolean;
  /** Returns an error message, or null when the value is valid. */
  validate?: (value: FieldValue) => string | null;
}

export const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

/** Field values compared by content (arrays included). */
export function sameValue(a: FieldValue, b: FieldValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
