import type { Context, Logger, Runner } from '@linux-toolchain/core';

/** One selectable value of a select/multi option. */
export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectOption {
  key: string;
  kind: 'select';
  label: string;
  choices: Choice[];
  default: string;
}

export interface MultiOption {
  key: string;
  kind: 'multi';
  label: string;
  choices: Choice[];
  /** Pre-checked values; for `addons` these are the recommended add-ons. */
  default: string[];
  /** Minimum number of values the user must keep (default 0). */
  min?: number;
}

export interface ConfirmOption {
  key: string;
  kind: 'confirm';
  label: string;
  default: boolean;
}

/** A toolchain sub-option. Add-ons are a `multi` option with key `addons`. */
export type Option = SelectOption | MultiOption | ConfirmOption;

export type ChoiceValue = string | string[] | boolean;

/** Resolved option values for one toolchain, keyed by option key. */
export type Choices = Record<string, ChoiceValue>;

/** Read-only system probes used before and during installation. Injectable for tests. */
export interface Probes {
  ctx: Context;
  /** True if `path` exists (file or directory). */
  exists(path: string): boolean;
  /** Entry names of a directory; [] when it is missing or unreadable. */
  listDir(path: string): string[];
}

export interface InstallContext extends Probes {
  runner: Runner;
  logger: Logger;
  /** `-y/--yes`: accept prompts such as the Android SDK licenses. */
  yes: boolean;
  /** Log a warning and collect it for the end-of-run summary (e.g. a failed add-on). */
  warn(message: string): void;
  /** Warnings collected by `warn`, in order. */
  readonly warnings: string[];
  /** Injectable fetch for version lookups (GitHub API, go.dev, ...). */
  fetch: typeof fetch;
}

export interface Toolchain {
  /** Stable id, identical to install-toolchains.sh. */
  id: string;
  label: string;
  description: string;
  /** Components this one needs; auto-added unless already present (see resolveSelection). */
  requires?: string[];
  /** True when this component is already installed, so `requires` need not add it. */
  isPresent?(probes: Probes): Promise<boolean> | boolean;
  /** Add-on value -> component id it selects (e.g. flutter `android-sdk` -> `android`). */
  addonImplies?: Record<string, string>;
  options: Option[];
  install(ic: InstallContext, choices: Choices): Promise<void>;
}
