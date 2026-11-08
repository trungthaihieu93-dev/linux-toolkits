/**
 * GVariant text codec for the value types terminal schemas use: `b`, `y`,
 * `n`, `q`, `i`, `u`, `d`, `s`, `o`, `g`, arrays, tuples and maybes of
 * those (for example `as`, `a(ss)`, `(uu)`, `ms`). Byte strings (`ay`),
 * variants, dictionaries, 64-bit integers and nested maybes are rejected.
 *
 * `formatGVariant` output is one argv element for `gsettings set`; it is
 * never meant to pass through a shell.
 */

export type GVariantValue = boolean | number | string | null | GVariantValue[];

export class GVariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GVariantError';
  }
}

type Basic = 'b' | 'y' | 'n' | 'q' | 'i' | 'u' | 'd' | 's' | 'o' | 'g';

type TypeNode =
  | { kind: 'basic'; code: Basic }
  | { kind: 'array'; of: TypeNode }
  | { kind: 'tuple'; items: TypeNode[] }
  | { kind: 'maybe'; of: TypeNode };

const BASIC = new Set<string>([
  'b',
  'y',
  'n',
  'q',
  'i',
  'u',
  'd',
  's',
  'o',
  'g',
]);

const INT_RANGES: Partial<Record<Basic, [number, number]>> = {
  y: [0, 0xff],
  n: [-0x8000, 0x7fff],
  q: [0, 0xffff],
  i: [-0x80000000, 0x7fffffff],
  u: [0, 0xffffffff],
};

/** Type keywords GVariant text accepts in front of a value. */
const KEYWORD_TYPES: Record<string, string> = {
  boolean: 'b',
  byte: 'y',
  int16: 'n',
  uint16: 'q',
  int32: 'i',
  uint32: 'u',
  double: 'd',
  string: 's',
  objectpath: 'o',
  signature: 'g',
};

function parseType(type: string): TypeNode {
  let pos = 0;
  const one = (): TypeNode => {
    const c = type[pos];
    if (c === undefined) throw new GVariantError(`incomplete type "${type}"`);
    pos++;
    if (BASIC.has(c)) return { kind: 'basic', code: c as Basic };
    if (c === 'a') {
      if (type[pos] === 'y') {
        throw new GVariantError('byte strings (ay) are not supported');
      }
      return { kind: 'array', of: one() };
    }
    if (c === 'm') {
      if (type[pos] === 'm') {
        throw new GVariantError('nested maybe types are not supported');
      }
      return { kind: 'maybe', of: one() };
    }
    if (c === '(') {
      const items: TypeNode[] = [];
      while (type[pos] !== ')') {
        if (pos >= type.length) {
          throw new GVariantError(`unclosed tuple in type "${type}"`);
        }
        items.push(one());
      }
      pos++;
      return { kind: 'tuple', items };
    }
    throw new GVariantError(`unsupported GVariant type "${c}" in "${type}"`);
  };
  const node = one();
  if (pos !== type.length) {
    throw new GVariantError(`type "${type}" is not a single complete type`);
  }
  return node;
}

/** True when `type` is a single type this codec handles. */
export function isSupportedGVariantType(type: string): boolean {
  try {
    parseType(type);
    return true;
  } catch {
    return false;
  }
}

function typeString(node: TypeNode): string {
  switch (node.kind) {
    case 'basic':
      return node.code;
    case 'array':
      return `a${typeString(node.of)}`;
    case 'maybe':
      return `m${typeString(node.of)}`;
    case 'tuple':
      return `(${node.items.map(typeString).join('')})`;
  }
}

// ---------------------------------------------------------------------------
// Parsing

const SIMPLE_ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

class Parser {
  private pos = 0;
  constructor(private readonly text: string) {}

  fail(message: string): never {
    throw new GVariantError(
      `${message} at offset ${this.pos} in ${JSON.stringify(this.text)}`,
    );
  }

  ws(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) {
      this.pos++;
    }
  }

  atEnd(): boolean {
    this.ws();
    return this.pos >= this.text.length;
  }

  peek(): string | undefined {
    return this.text[this.pos];
  }

  eat(token: string): boolean {
    this.ws();
    if (this.text.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  expect(token: string): void {
    if (!this.eat(token)) this.fail(`expected "${token}"`);
  }

  word(): string | null {
    this.ws();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.pos));
    return m ? m[0] : null;
  }

  /** Consumes a type annotation (`@as`, `uint32`) and checks it. */
  annotation(expected: TypeNode): void {
    this.ws();
    if (this.peek() === '@') {
      this.pos++;
      const m = /^[a-z()]+/.exec(this.text.slice(this.pos));
      if (!m) this.fail('expected a type after "@"');
      this.pos += m[0].length;
      let annotated: string;
      try {
        annotated = typeString(parseType(m[0]));
      } catch (error) {
        this.fail((error as Error).message);
      }
      if (annotated !== typeString(expected)) {
        this.fail(`type @${annotated} does not match ${typeString(expected)}`);
      }
      return;
    }
    const w = this.word();
    // A keyword in front of a maybe's value annotates the inner type.
    if (w !== null && w in KEYWORD_TYPES && expected.kind !== 'maybe') {
      if (KEYWORD_TYPES[w] !== typeString(expected)) {
        this.fail(`"${w}" does not match type ${typeString(expected)}`);
      }
      this.pos += w.length;
    }
  }

  value(type: TypeNode): GVariantValue {
    this.annotation(type);
    this.ws();
    switch (type.kind) {
      case 'maybe': {
        const w = this.word();
        if (w === 'nothing') {
          this.pos += w.length;
          return null;
        }
        if (w === 'just') this.pos += w.length;
        return this.value(type.of);
      }
      case 'array': {
        this.expect('[');
        const items: GVariantValue[] = [];
        if (this.eat(']')) return items;
        do items.push(this.value(type.of));
        while (this.eat(','));
        this.expect(']');
        return items;
      }
      case 'tuple': {
        this.expect('(');
        const items: GVariantValue[] = [];
        type.items.forEach((item, i) => {
          if (i > 0) this.expect(',');
          items.push(this.value(item));
        });
        if (type.items.length === 1) this.expect(',');
        this.expect(')');
        return items;
      }
      case 'basic':
        return this.basic(type.code);
    }
  }

  basic(code: Basic): GVariantValue {
    if (code === 'b') {
      const w = this.word();
      if (w === 'true' || w === 'false') {
        this.pos += w.length;
        return w === 'true';
      }
      this.fail('expected true or false');
    }
    if (code === 's' || code === 'o' || code === 'g') return this.string();
    const m =
      /^[-+]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?|inf|nan)/.exec(
        this.text.slice(this.pos),
      );
    if (!m) this.fail('expected a number');
    this.pos += m[0].length;
    const literal = m[0];
    if (code === 'd') {
      const n = Number(literal);
      if (!Number.isFinite(n))
        this.fail('non-finite doubles are not supported');
      return n;
    }
    const negative = literal.startsWith('-');
    const digits = literal.replace(/^[-+]/, '');
    if (!/^(0[xX][0-9a-fA-F]+|\d+)$/.test(digits)) {
      this.fail(`expected an integer for type ${code}`);
    }
    const n = (negative ? -1 : 1) * Number(digits);
    checkInt(n, code);
    return n;
  }

  string(): string {
    this.ws();
    const quote = this.peek();
    if (quote !== "'" && quote !== '"') this.fail('expected a quoted string');
    this.pos++;
    let out = '';
    for (;;) {
      const c = this.text[this.pos++];
      if (c === undefined) this.fail('unterminated string');
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.text[this.pos++];
      if (e === undefined) this.fail('unterminated escape');
      if (e in SIMPLE_ESCAPES) out += SIMPLE_ESCAPES[e];
      else if (e === 'u' || e === 'U') {
        const len = e === 'u' ? 4 : 8;
        const hex = this.text.slice(this.pos, this.pos + len);
        if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) {
          this.fail(`bad \\${e} escape`);
        }
        this.pos += len;
        out += String.fromCodePoint(parseInt(hex, 16));
      } else out += e;
    }
  }
}

function checkInt(n: number, code: Basic): void {
  const range = INT_RANGES[code];
  if (!range) return;
  if (!Number.isInteger(n) || n < range[0] || n > range[1]) {
    throw new GVariantError(`${n} is out of range for type ${code}`);
  }
}

/** Parse GVariant text (as printed by `gsettings get`) as a value of `type`. */
export function parseGVariant(text: string, type: string): GVariantValue {
  const node = parseType(type);
  const parser = new Parser(text);
  const value = parser.value(node);
  if (!parser.atEnd()) parser.fail('unexpected trailing text');
  return value;
}

// ---------------------------------------------------------------------------
// Formatting

function quoteString(value: string): string {
  if (value.includes('\0')) {
    throw new GVariantError('GVariant strings cannot contain NUL');
  }
  let out = "'";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return `${out}'`;
}

function format(value: GVariantValue, node: TypeNode, top: boolean): string {
  switch (node.kind) {
    case 'maybe':
      if (value === null)
        return top ? `@${typeString(node)} nothing` : 'nothing';
      return format(value, node.of, top);
    case 'array': {
      if (!Array.isArray(value)) {
        throw new GVariantError(`expected an array for ${typeString(node)}`);
      }
      if (value.length === 0) return `@${typeString(node)} []`;
      return `[${value.map((v) => format(v, node.of, false)).join(', ')}]`;
    }
    case 'tuple': {
      if (!Array.isArray(value) || value.length !== node.items.length) {
        throw new GVariantError(
          `expected ${node.items.length} items for ${typeString(node)}`,
        );
      }
      const parts = value.map((v, i) => format(v, node.items[i], false));
      return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`;
    }
    case 'basic': {
      const code = node.code;
      if (code === 'b') {
        if (typeof value !== 'boolean')
          throw new GVariantError('expected a boolean');
        return String(value);
      }
      if (code === 's' || code === 'o' || code === 'g') {
        if (typeof value !== 'string')
          throw new GVariantError('expected a string');
        return quoteString(value);
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new GVariantError(`expected a finite number for type ${code}`);
      }
      if (code === 'd') {
        return Number.isInteger(value) ? value.toFixed(1) : String(value);
      }
      checkInt(value, code);
      return String(value);
    }
  }
}

/** Format `value` as GVariant text of `type`, readable by `gsettings set`. */
export function formatGVariant(value: GVariantValue, type: string): string {
  return format(value, parseType(type), true);
}

/**
 * Canonical text of a GVariant value, for comparing values that print
 * differently (`uint32 80` and `80`). Returns null when `text` is invalid.
 */
export function canonicalGVariant(text: string, type: string): string | null {
  try {
    return formatGVariant(parseGVariant(text, type), type);
  } catch {
    return null;
  }
}
