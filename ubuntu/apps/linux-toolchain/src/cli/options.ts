import {
  catalog as defaultCatalog,
  parseOpts,
  type Choices,
  type Toolchain,
} from '@linux-toolchain/toolchains';

/** Invalid command-line usage; the CLI exits with code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Raw flags as commander hands them to the install action. */
export interface InstallFlags {
  all?: boolean;
  only?: string;
  opt?: string[];
  defaults?: boolean;
  user?: string;
  yes?: boolean;
  dryRun?: boolean;
}

/** Validated install request. */
export interface RunConfig {
  /** Explicitly selected ids in catalog order; empty means "ask" (no ids, no --all). */
  ids: string[];
  /** `--opt` overrides keyed by toolchain id. */
  overrides: Map<string, Choices>;
  /** `--defaults`: never ask sub-options. */
  defaults: boolean;
  /** `--user`: target user (root only; checked when the context is resolved). */
  user?: string;
  /** `-y/--yes`: skip confirmations, accept the Android SDK licenses. */
  yes: boolean;
  dryRun: boolean;
}

function splitIds(values: readonly string[]): string[] {
  return values
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Turn positional ids and flags into a RunConfig. Positional ids and `--only`
 * are equivalent (both accept comma lists) and may be combined; `--all`
 * excludes both. Throws UsageError on any invalid input.
 */
export function parseRunConfig(
  positional: readonly string[],
  flags: InstallFlags,
  catalog: readonly Toolchain[] = defaultCatalog,
): RunConfig {
  if (flags.only !== undefined && splitIds([flags.only]).length === 0) {
    throw new UsageError('--only needs a comma-separated list (see `list`)');
  }
  const picked = splitIds([
    ...positional,
    ...(flags.only !== undefined ? [flags.only] : []),
  ]);
  if (flags.all && picked.length > 0) {
    throw new UsageError(
      '--all cannot be combined with toolchain ids or --only',
    );
  }

  const valid = catalog.map((t) => t.id);
  const unknown = picked.filter((id) => !valid.includes(id));
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown toolchain: ${unknown.join(', ')} (valid: ${valid.join(', ')})`,
    );
  }

  if (flags.user !== undefined && !flags.user.trim()) {
    throw new UsageError('--user needs a user name');
  }

  let overrides: Map<string, Choices>;
  try {
    overrides = parseOpts(flags.opt ?? [], catalog);
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    ids: flags.all ? [...valid] : valid.filter((id) => picked.includes(id)),
    overrides,
    defaults: flags.defaults ?? false,
    user: flags.user?.trim() || undefined,
    yes: flags.yes ?? false,
    dryRun: flags.dryRun ?? false,
  };
}
