import chalk from 'chalk';
import {
  checkbox as inquirerCheckbox,
  confirm as inquirerConfirm,
  select as inquirerSelect,
} from '@inquirer/prompts';
import {
  defaultsFor,
  mergeChoices,
  type Choice,
  type Choices,
  type MultiOption,
  type Option,
  type SelectOption,
  type Toolchain,
} from '@linux-toolchain/toolchains';

export interface PromptChoice {
  name: string;
  value: string;
  description?: string;
  checked?: boolean;
}

/** The subset of @inquirer/prompts the CLI uses; injected so tests can script answers. */
export interface PromptFns {
  checkbox(config: {
    message: string;
    choices: PromptChoice[];
    required?: boolean;
    pageSize?: number;
    validate?: (picked: readonly { value: string }[]) => boolean | string;
  }): Promise<string[]>;
  select(config: {
    message: string;
    choices: PromptChoice[];
    default?: string;
  }): Promise<string>;
  confirm(config: { message: string; default?: boolean }): Promise<boolean>;
}

export const inquirerPrompts: PromptFns = {
  checkbox: (config) => inquirerCheckbox(config),
  select: (config) => inquirerSelect(config),
  confirm: (config) => inquirerConfirm(config),
};

/** True for the error @inquirer/prompts throws when the user presses Ctrl+C. */
export function isPromptAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

/**
 * Select options whose valid values depend on another option of the same
 * toolchain: the default JDK can only be one of the JDKs being installed.
 */
const LIMITED_BY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  java: { default: 'jdk' },
};

function allowedChoices(
  toolchain: Toolchain,
  option: SelectOption,
  choices: Choices,
): Choice[] {
  const sourceKey = LIMITED_BY[toolchain.id]?.[option.key];
  const source = sourceKey ? choices[sourceKey] : undefined;
  if (!Array.isArray(source)) return option.choices;
  const limited = option.choices.filter((c) => source.includes(c.value));
  return limited.length > 0 ? limited : option.choices;
}

/** Default for a select option given the choices still allowed: its own default, else the last (highest). */
function selectDefault(option: SelectOption, allowed: Choice[]): string {
  return allowed.some((c) => c.value === option.default)
    ? option.default
    : (allowed[allowed.length - 1] as Choice).value;
}

/**
 * Defaults merged with `--opt` overrides; dependent selects that were not set
 * explicitly are moved to a valid value (java.jdk=17 alone makes the default 17).
 */
export function resolveChoices(
  toolchain: Toolchain,
  overrides: Choices = {},
): Choices {
  const choices = mergeChoices(defaultsFor(toolchain), overrides);
  for (const option of toolchain.options) {
    if (option.kind !== 'select' || option.key in overrides) continue;
    choices[option.key] = selectDefault(
      option,
      allowedChoices(toolchain, option, choices),
    );
  }
  return choices;
}

function choiceName(choice: Choice): string {
  return choice.hint
    ? `${choice.label} ${chalk.dim(`(${choice.hint})`)}`
    : choice.label;
}

function multiMessage(option: MultiOption): string {
  return option.key === 'addons'
    ? `${option.label} (recommended are pre-checked)`
    : option.label;
}

async function askOption(
  toolchain: Toolchain,
  option: Option,
  choices: Choices,
  prompts: PromptFns,
): Promise<void> {
  switch (option.kind) {
    case 'confirm':
      choices[option.key] = await prompts.confirm({
        message: option.label,
        default: option.default,
      });
      return;
    case 'select': {
      const allowed = allowedChoices(toolchain, option, choices);
      const fallback = selectDefault(option, allowed);
      // Nothing to decide when only one value is possible.
      choices[option.key] =
        allowed.length === 1
          ? fallback
          : await prompts.select({
              message: option.label,
              choices: allowed.map((c) => ({
                name: choiceName(c),
                value: c.value,
              })),
              default: fallback,
            });
      return;
    }
    case 'multi': {
      const min = option.min ?? 0;
      const picked = await prompts.checkbox({
        message: multiMessage(option),
        choices: option.choices.map((c) => ({
          name: choiceName(c),
          value: c.value,
          checked: option.default.includes(c.value),
        })),
        required: min > 0,
        validate: (items) => items.length >= min || `select at least ${min}`,
      });
      // Keep catalog order regardless of the order the prompt returns.
      choices[option.key] = option.choices
        .map((c) => c.value)
        .filter((v) => picked.includes(v));
      return;
    }
  }
}

/**
 * Ask every option of one toolchain in catalog order. Options set with `--opt`
 * are taken as given and not asked again.
 */
export async function promptChoices(
  toolchain: Toolchain,
  overrides: Choices,
  prompts: PromptFns,
): Promise<Choices> {
  const choices = resolveChoices(toolchain, overrides);
  for (const option of toolchain.options) {
    if (option.key in overrides) continue;
    await askOption(toolchain, option, choices, prompts);
  }
  return choices;
}

/** Toolchain multi-select shown when no ids, `--all` or `--only` were given. */
export function promptToolchains(
  catalog: readonly Toolchain[],
  prompts: PromptFns,
): Promise<string[]> {
  return prompts.checkbox({
    message: 'Select toolchains to install',
    pageSize: catalog.length,
    choices: catalog.map((t) => ({
      name: t.label,
      value: t.id,
      description: t.description,
    })),
  });
}

export const ANDROID_LICENSE_QUESTION =
  'Accept the Android SDK licenses (https://developer.android.com/studio/terms)?';
