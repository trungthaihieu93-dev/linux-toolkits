import { catalog as defaultCatalog } from './catalog';
import type { ChoiceValue, Choices, Option, Toolchain } from './types';

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'on', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'off', '0']);

function validValues(option: Option): string {
  return option.kind === 'confirm'
    ? 'true, false, yes, no'
    : option.choices.map((c) => c.value).join(', ');
}

/** Parse and validate one raw `--opt` value against its option. */
export function parseValue(toolchainId: string, option: Option, raw: string): ChoiceValue {
  const where = `${toolchainId}.${option.key}`;
  const value = raw.trim();
  const invalid = (bad: string) =>
    new Error(`invalid value for ${where}: "${bad}" (valid: ${validValues(option)})`);

  switch (option.kind) {
    case 'confirm': {
      const word = value.toLowerCase();
      if (TRUE_WORDS.has(word)) return true;
      if (FALSE_WORDS.has(word)) return false;
      throw invalid(value);
    }
    case 'select': {
      if (!option.choices.some((c) => c.value === value)) throw invalid(value);
      return value;
    }
    case 'multi': {
      const picked = [
        ...new Set(
          value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
      for (const v of picked) {
        if (!option.choices.some((c) => c.value === v)) throw invalid(v);
      }
      const min = option.min ?? 0;
      if (picked.length < min) {
        throw new Error(`${where} needs at least ${min} value(s) (valid: ${validValues(option)})`);
      }
      // Keep choice order so output is stable regardless of how the user typed it.
      return option.choices.map((c) => c.value).filter((v) => picked.includes(v));
    }
  }
}

/**
 * Parse `--opt id.key=value` entries. Multi options take comma lists (empty =
 * none), confirm options take true/false/yes/no. Later entries for the same
 * key win. Returns only the overrides; combine with defaultsFor/mergeChoices.
 */
export function parseOpts(
  list: readonly string[],
  catalog: readonly Toolchain[] = defaultCatalog,
): Map<string, Choices> {
  const result = new Map<string, Choices>();
  for (const entry of list) {
    const eq = entry.indexOf('=');
    const dot = entry.indexOf('.');
    if (eq < 0 || dot < 0 || dot > eq) {
      throw new Error(`invalid option "${entry}" (expected id.key=value, e.g. java.jdk=17,21)`);
    }
    const id = entry.slice(0, dot).trim();
    const key = entry.slice(dot + 1, eq).trim();
    const toolchain = catalog.find((t) => t.id === id);
    if (!toolchain) {
      throw new Error(`unknown toolchain in option "${entry}": ${id} (valid: ${catalog.map((t) => t.id).join(', ')})`);
    }
    const option = toolchain.options.find((o) => o.key === key);
    if (!option) {
      const keys = toolchain.options.map((o) => o.key);
      throw new Error(
        `unknown option for ${id}: ${key} (${keys.length ? `valid: ${keys.join(', ')}` : `${id} has no options`})`,
      );
    }
    const choices = result.get(id) ?? {};
    choices[key] = parseValue(id, option, entry.slice(eq + 1));
    result.set(id, choices);
  }
  return result;
}

/** Default choices of a toolchain (fresh copies, safe to mutate). */
export function defaultsFor(toolchain: Toolchain): Choices {
  const choices: Choices = {};
  for (const option of toolchain.options) {
    choices[option.key] = Array.isArray(option.default) ? [...option.default] : option.default;
  }
  return choices;
}

/** Overrides replace defaults key by key. */
export function mergeChoices(defaults: Choices, overrides: Choices = {}): Choices {
  return { ...defaults, ...overrides };
}

/** Typed accessors for installers; they throw if the key is missing or has the wrong kind. */
export function choiceString(choices: Choices, key: string): string {
  const value = choices[key];
  if (typeof value !== 'string') throw new Error(`option ${key}: expected a single value`);
  return value;
}

export function choiceList(choices: Choices, key: string): string[] {
  const value = choices[key];
  if (!Array.isArray(value)) throw new Error(`option ${key}: expected a list`);
  return value;
}

export function choiceBool(choices: Choices, key: string): boolean {
  const value = choices[key];
  if (typeof value !== 'boolean') throw new Error(`option ${key}: expected true/false`);
  return value;
}
