/**
 * The Config-mode form model of an rc file and its rendering into the two
 * managed blocks. `parseBlock` reads back exactly what `renderBlock` writes;
 * any other line inside a block is kept verbatim in `extra`.
 *
 * Every value goes through `shQuote`, so sourcing the block assigns exactly
 * the input text (no expansion, no command substitution).
 */
import { shQuote } from '@linux-toolchain/core/shell';
import type {
  ManagedBlockName,
  ManagedBlockState,
  OhMyZshModel,
  OhMyZshState,
  OutsideLine,
  ShellBlockModel,
  ShellHistory,
  ShellName,
} from '../api';
import {
  type BlockResult,
  type BlockSpan,
  findBlock,
  MAIN_BLOCK,
  OMZ_BLOCK,
  ohMyZshDisabledReason,
  ohMyZshSourceLines,
  setMainBlock,
  setOmzBlock,
} from './managed-block';
import { summarizeOutside } from './outside';

/** First line of every main block td renders. */
export const BLOCK_HEADER =
  '# Managed by term-dashboard (td): edits inside this block are overwritten.';

const ALIAS_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:+@%,-]*$/;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLUGIN_NAME = /^[A-Za-z0-9_.+@-]+$/;
const MARKER_LINE = /^\s*# (>>>|<<<) /m;
const MAX_HISTORY = 1_000_000_000;

export function emptyShellModel(): ShellBlockModel {
  return {
    aliases: [],
    exports: [],
    path: { prepend: [], append: [] },
    history: {},
  };
}

// ---------------------------------------------------------------------------
// Validation

function checkText(errors: string[], what: string, value: string): void {
  if (value.includes('\0')) errors.push(`${what} contains a NUL byte`);
  if (MARKER_LINE.test(value)) {
    errors.push(`${what} contains a line that looks like a block marker`);
  }
}

/** Problems that would make the rendered block wrong; empty when valid. */
export function validateShellModel(
  model: ShellBlockModel,
  shell: ShellName,
): string[] {
  const errors: string[] = [];
  const seenAliases = new Set<string>();
  for (const { name, command } of model.aliases) {
    if (!ALIAS_NAME.test(name))
      errors.push(`invalid alias name ${JSON.stringify(name)}`);
    else if (seenAliases.has(name))
      errors.push(`alias "${name}" is defined twice`);
    seenAliases.add(name);
    if (command === '') errors.push(`alias "${name}" has an empty command`);
    checkText(errors, `alias "${name}"`, command);
  }
  const seenVars = new Set<string>();
  for (const { name, value } of model.exports) {
    if (!VAR_NAME.test(name))
      errors.push(`invalid variable name ${JSON.stringify(name)}`);
    else if (name === 'PATH')
      errors.push('set PATH in the PATH section, not as an export');
    else if (seenVars.has(name))
      errors.push(`variable "${name}" is exported twice`);
    seenVars.add(name);
    checkText(errors, `variable "${name}"`, value);
  }
  for (const entry of [...model.path.prepend, ...model.path.append]) {
    if (entry === '' || /[:\n\r\0]/.test(entry)) {
      errors.push(
        `invalid PATH entry ${JSON.stringify(entry)} (empty, or contains ":" or a line break)`,
      );
    }
  }
  const h = model.history;
  for (const [field, n] of [
    ['size', h.size],
    ['fileSize', h.fileSize],
  ] as const) {
    if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > MAX_HISTORY)) {
      errors.push(
        `history ${field} must be a whole number from 0 to ${MAX_HISTORY}`,
      );
    }
  }
  if (model.ohMyZsh) {
    if (shell !== 'zsh') errors.push('oh-my-zsh settings apply to zsh only');
    const { theme, plugins = [], extra = [] } = model.ohMyZsh;
    if (theme !== undefined && /[\n\r\0]/.test(theme)) {
      errors.push('the oh-my-zsh theme cannot contain line breaks');
    }
    for (const p of plugins) {
      if (!PLUGIN_NAME.test(p))
        errors.push(`invalid oh-my-zsh plugin name ${JSON.stringify(p)}`);
    }
    extra.forEach((line) => checkText(errors, 'an extra oh-my-zsh line', line));
  }
  (model.extra ?? []).forEach((line) =>
    checkText(errors, 'an extra line', line),
  );
  return errors;
}

export class ShellModelError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'ShellModelError';
  }
}

// ---------------------------------------------------------------------------
// Rendering

function pathEntry(entry: string): string {
  if (entry === '~') return '"$HOME"';
  if (entry.startsWith('~/')) return `"$HOME"${shQuote(entry.slice(1))}`;
  return shQuote(entry);
}

function historyLines(h: ShellHistory, shell: ShellName): string[] {
  const out: string[] = [];
  if (h.size !== undefined) out.push(`HISTSIZE=${h.size}`);
  if (shell === 'bash') {
    if (h.fileSize !== undefined) out.push(`HISTFILESIZE=${h.fileSize}`);
    if (h.ignoreDups !== undefined) {
      out.push(h.ignoreDups ? 'HISTCONTROL=ignoredups' : 'unset HISTCONTROL');
    }
    if (h.share !== undefined)
      out.push(`shopt ${h.share ? '-s' : '-u'} histappend`);
  } else {
    if (h.fileSize !== undefined) out.push(`SAVEHIST=${h.fileSize}`);
    if (h.ignoreDups !== undefined) {
      out.push(`${h.ignoreDups ? 'setopt' : 'unsetopt'} HIST_IGNORE_DUPS`);
    }
    if (h.share !== undefined)
      out.push(`${h.share ? 'setopt' : 'unsetopt'} SHARE_HISTORY`);
  }
  return out;
}

/**
 * Body of the main block (without markers) for `shell`. `ohMyZsh` is not
 * part of it; see `renderOmzBlock`. Throws `ShellModelError` when invalid.
 */
export function renderBlock(model: ShellBlockModel, shell: ShellName): string {
  const problems = validateShellModel(model, shell);
  if (problems.length) throw new ShellModelError(problems);
  const lines = [BLOCK_HEADER];
  for (const a of model.aliases)
    lines.push(`alias ${a.name}=${shQuote(a.command)}`);
  for (const e of model.exports)
    lines.push(`export ${e.name}=${shQuote(e.value)}`);
  const { prepend, append } = model.path;
  if (prepend.length || append.length) {
    const parts = [
      ...prepend.map(pathEntry),
      '"$PATH"',
      ...append.map(pathEntry),
    ];
    lines.push(`export PATH=${parts.join(':')}`);
  }
  lines.push(...historyLines(model.history, shell));
  lines.push(...(model.extra ?? []));
  return lines.join('\n');
}

/** Body of the oh-my-zsh block, or null when there is nothing to write. */
export function renderOmzBlock(omz: OhMyZshModel | undefined): string | null {
  if (!omz) return null;
  const lines: string[] = [];
  if (omz.theme !== undefined) lines.push(`ZSH_THEME=${shQuote(omz.theme)}`);
  if (omz.plugins !== undefined) {
    lines.push(`plugins=(${omz.plugins.map(shQuote).join(' ')})`);
  }
  lines.push(...(omz.extra ?? []));
  return lines.length ? lines.join('\n') : null;
}

// ---------------------------------------------------------------------------
// Parsing

/** Inverse of `shQuote` (and concatenations of it); null for anything else. */
export function unquoteShWord(word: string): string | null {
  if (word === '') return null;
  let out = '';
  let i = 0;
  while (i < word.length) {
    if (word[i] === "'") {
      const j = word.indexOf("'", i + 1);
      if (j === -1) return null;
      out += word.slice(i + 1, j);
      i = j + 1;
    } else if (word.startsWith("\\'", i)) {
      out += "'";
      i += 2;
    } else return null;
  }
  return out;
}

type QuoteState = 'none' | 'single' | 'double';

function scanQuotes(line: string, state: QuoteState): QuoteState {
  let s = state;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (s === 'single') {
      if (c === "'") s = 'none';
    } else if (s === 'double') {
      if (c === '\\') i++;
      else if (c === '"') s = 'none';
    } else if (c === '\\') i++;
    else if (c === "'") s = 'single';
    else if (c === '"') s = 'double';
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
  }
  return s;
}

const CONTINUABLE = /^(alias |export |ZSH_THEME=|plugins=\()/;

/**
 * Split a block body into statements: a line td wrote with a quoted value
 * spanning several lines (a value with newlines) is joined back together.
 */
export function splitStatements(body: string): string[] {
  if (body === '') return [];
  const lines = body.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let state = scanQuotes(lines[i], 'none');
    if (state === 'none' || !CONTINUABLE.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    let j = i;
    while (state !== 'none' && j + 1 < lines.length) {
      j++;
      state = scanQuotes(lines[j], state);
    }
    if (state !== 'none') {
      out.push(lines[i]);
      continue;
    }
    out.push(lines.slice(i, j + 1).join('\n'));
    i = j;
  }
  return out;
}

function parsePath(
  value: string,
): { prepend: string[]; append: string[] } | null {
  const parts = value.split(':');
  const at = parts.indexOf('"$PATH"');
  if (at === -1 || parts.lastIndexOf('"$PATH"') !== at) return null;
  const decode = (p: string): string | null => {
    if (p === '"$HOME"') return '~';
    if (p.startsWith('"$HOME"')) {
      const rest = unquoteShWord(p.slice(7));
      return rest !== null && rest.startsWith('/') ? `~${rest}` : null;
    }
    return unquoteShWord(p);
  };
  const prepend = parts.slice(0, at).map(decode);
  const append = parts.slice(at + 1).map(decode);
  const all = [...prepend, ...append];
  if (all.some((p) => p === null || p === '')) return null;
  return { prepend: prepend as string[], append: append as string[] };
}

const HISTORY_LINES: [RegExp, (m: RegExpExecArray, h: ShellHistory) => void][] =
  [
    [/^HISTSIZE=(\d+)$/, (m, h) => (h.size = Number(m[1]))],
    [
      /^(?:HISTFILESIZE|SAVEHIST)=(\d+)$/,
      (m, h) => (h.fileSize = Number(m[1])),
    ],
    [/^HISTCONTROL=ignoredups$/, (_m, h) => (h.ignoreDups = true)],
    [/^unset HISTCONTROL$/, (_m, h) => (h.ignoreDups = false)],
    [
      /^(setopt|unsetopt) HIST_IGNORE_DUPS$/,
      (m, h) => (h.ignoreDups = m[1] === 'setopt'),
    ],
    [/^shopt (-s|-u) histappend$/, (m, h) => (h.share = m[1] === '-s')],
    [
      /^(setopt|unsetopt) SHARE_HISTORY$/,
      (m, h) => (h.share = m[1] === 'setopt'),
    ],
  ];

const HISTORY_FIELD: Record<number, keyof ShellHistory> = {
  0: 'size',
  1: 'fileSize',
  2: 'ignoreDups',
  3: 'ignoreDups',
  4: 'ignoreDups',
  5: 'share',
  6: 'share',
};

/**
 * Read a main block body. Unknown lines (and repeats of a field td writes
 * once) land in `extra`, verbatim and in order.
 */
export function parseBlock(body: string): ShellBlockModel {
  const model = emptyShellModel();
  const extra: string[] = [];
  let pathSeen = false;
  for (const stmt of splitStatements(body)) {
    if (stmt === BLOCK_HEADER) continue;
    const alias = /^alias ([^=\s]+)=([\s\S]*)$/.exec(stmt);
    if (alias && ALIAS_NAME.test(alias[1])) {
      const command = unquoteShWord(alias[2]);
      if (command !== null && !model.aliases.some((a) => a.name === alias[1])) {
        model.aliases.push({ name: alias[1], command });
        continue;
      }
    }
    const pathLine = /^export PATH=([\s\S]*)$/.exec(stmt);
    if (pathLine) {
      const path = pathSeen ? null : parsePath(pathLine[1]);
      if (path) {
        model.path = path;
        pathSeen = true;
        continue;
      }
      extra.push(stmt);
      continue;
    }
    const exp = /^export ([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(stmt);
    if (exp) {
      const value = unquoteShWord(exp[2]);
      if (value !== null && !model.exports.some((e) => e.name === exp[1])) {
        model.exports.push({ name: exp[1], value });
        continue;
      }
    }
    const idx = HISTORY_LINES.findIndex(([re]) => re.test(stmt));
    if (idx !== -1 && model.history[HISTORY_FIELD[idx]] === undefined) {
      const [re, apply] = HISTORY_LINES[idx];
      apply(re.exec(stmt) as RegExpExecArray, model.history);
      continue;
    }
    extra.push(stmt);
  }
  if (extra.length) model.extra = extra;
  return model;
}

/** Split `'a' 'b''\''c'` into words; null when it is not shQuote output. */
function splitQuotedWords(text: string): string[] | null {
  const words: string[] = [];
  const re = /(?:'[^']*'|\\')+/y;
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ') {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return null;
    const word = unquoteShWord(m[0]);
    if (word === null) return null;
    words.push(word);
    i = re.lastIndex;
  }
  return words;
}

export function parseOmzBlock(body: string): OhMyZshModel {
  const omz: OhMyZshModel = {};
  const extra: string[] = [];
  for (const stmt of splitStatements(body)) {
    const theme = /^ZSH_THEME=([\s\S]*)$/.exec(stmt);
    if (theme && omz.theme === undefined) {
      const value = unquoteShWord(theme[1]);
      if (value !== null) {
        omz.theme = value;
        continue;
      }
    }
    const plugins = /^plugins=\(([^)]*)\)$/.exec(stmt);
    if (plugins && omz.plugins === undefined) {
      const words = splitQuotedWords(plugins[1]);
      if (words !== null) {
        omz.plugins = words;
        continue;
      }
    }
    extra.push(stmt);
  }
  if (extra.length) omz.extra = extra;
  return omz;
}

// ---------------------------------------------------------------------------
// Whole-file helpers

function blockState(
  name: ManagedBlockName,
  span: BlockSpan | null,
): ManagedBlockState {
  return {
    name,
    present: span !== null,
    startLine: span ? span.start + 1 : null,
    endLine: span ? span.end + 1 : null,
  };
}

export interface ShellFileAnalysis {
  blocks: { main: ManagedBlockState; omz: ManagedBlockState | null };
  model: ShellBlockModel | null;
  modelError?: string;
  outside: OutsideLine[];
  ohMyZsh: OhMyZshState | null;
}

/** Read the managed blocks of `text` into the form model. */
export function readShellModel(
  text: string,
  shell: ShellName,
): BlockResult<ShellBlockModel> {
  const main = findBlock(text, MAIN_BLOCK);
  if (!main.ok) return main;
  const model = main.value ? parseBlock(main.value.body) : emptyShellModel();
  if (shell === 'zsh') {
    const omz = findBlock(text, OMZ_BLOCK);
    if (!omz.ok) return omz;
    if (omz.value) model.ohMyZsh = parseOmzBlock(omz.value.body);
  }
  return { ok: true, value: model };
}

/**
 * Write `model` into `text`: the main block (removed when the model is
 * empty) and, for zsh, the oh-my-zsh block above the `source` line (removed
 * when `ohMyZsh` has nothing to set). Text outside the blocks is unchanged.
 */
export function applyShellModel(
  text: string,
  model: ShellBlockModel,
  shell: ShellName,
): BlockResult<string> {
  const problems = validateShellModel(model, shell);
  if (problems.length) return { ok: false, error: problems.join('; ') };
  const body = renderBlock(model, shell);
  const main = setMainBlock(text, body === BLOCK_HEADER ? null : body);
  if (!main.ok || shell !== 'zsh') return main;
  return setOmzBlock(main.value, renderOmzBlock(model.ohMyZsh));
}

/** Everything Config mode shows about a file, from its text alone. */
export function analyzeShellFile(
  text: string,
  shell: ShellName,
): ShellFileAnalysis {
  const main = findBlock(text, MAIN_BLOCK);
  const omz = shell === 'zsh' ? findBlock(text, OMZ_BLOCK) : null;
  const errors = [main, omz].flatMap((r) => (r && !r.ok ? [r.error] : []));
  const span = (r: typeof main | null) => (r && r.ok ? r.value : null);
  const model = readShellModel(text, shell);
  let ohMyZsh: OhMyZshState | null = null;
  if (shell === 'zsh') {
    const lines = ohMyZshSourceLines(text);
    const reason = ohMyZshDisabledReason(text);
    ohMyZsh = {
      detected: lines.length > 0,
      sourceLine: lines.length === 1 ? lines[0] + 1 : null,
      editable: reason === null,
    };
    if (reason !== null) ohMyZsh.disabledReason = reason;
  }
  const out: ShellFileAnalysis = {
    blocks: {
      main: blockState(MAIN_BLOCK, span(main)),
      omz: omz ? blockState(OMZ_BLOCK, span(omz)) : null,
    },
    model: model.ok ? model.value : null,
    outside: summarizeOutside(text),
    ohMyZsh,
  };
  if (errors.length) out.modelError = errors.join('; ');
  return out;
}
