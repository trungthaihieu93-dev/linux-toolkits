import chalk from 'chalk';
import {
  aptInstall,
  type Context,
  type Logger,
  type Runner,
  type TextSink,
} from '@linux-toolchain/core';
import {
  createInstallContext,
  type ChoiceValue,
  type Choices,
  type InstallContextInit,
  type Toolchain,
} from '@linux-toolchain/toolchains';

/** One toolchain ready to install. */
export interface PlannedToolchain {
  toolchain: Toolchain;
  choices: Choices;
  /** Value for InstallContext.yes (Android: true only once the licenses were accepted). */
  yes: boolean;
  /** When set, the toolchain is not run and is reported as failed with this reason. */
  skipReason?: string;
}

export interface ToolchainWarning {
  id: string;
  message: string;
}

export interface ExecutionResult {
  ok: string[];
  failed: string[];
  warnings: ToolchainWarning[];
}

export interface ExecuteDeps {
  runner: Runner;
  ctx: Context;
  logger: Logger;
  fetch?: InstallContextInit['fetch'];
  exists?: InstallContextInit['exists'];
  listDir?: InstallContextInit['listDir'];
}

/** Packages every toolchain may rely on; same list as install-toolchains.sh. */
export const BASE_PACKAGES = [
  'curl',
  'ca-certificates',
  'git',
  'unzip',
  'xz-utils',
  'zip',
] as const;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatValue(value: ChoiceValue): string {
  if (Array.isArray(value)) return value.length ? value.join(',') : '-';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return value;
}

/** Review table: one row per toolchain with its chosen options. */
export function renderReview(plan: readonly PlannedToolchain[]): string {
  const idWidth = Math.max(2, ...plan.map((p) => p.toolchain.id.length));
  const lines = [
    chalk.bold(`  ${'id'.padEnd(idWidth)}  choices`),
    ...plan.map(({ toolchain, choices, skipReason }) => {
      const parts = toolchain.options.map((o) => {
        const value = choices[o.key];
        return `${o.key}=${value === undefined ? '-' : formatValue(value)}`;
      });
      const detail = skipReason
        ? chalk.red(`skipped: ${skipReason}`)
        : parts.length
          ? parts.join('  ')
          : chalk.dim('(no options)');
      return `  ${chalk.cyan(toolchain.id.padEnd(idWidth))}  ${detail}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Refresh apt and install the base packages, as install-toolchains.sh did
 * before any component. Without apt only curl is required (the caller already
 * warned). Throws when `apt-get update` fails.
 */
export async function prepareSystem(
  runner: Runner,
  apt: boolean,
  curl: boolean,
): Promise<void> {
  if (!apt) {
    if (!curl) throw new Error('curl is required');
    return;
  }
  try {
    await runner.asRoot('apt-get update -y', 'apt-get update');
  } catch (error) {
    throw new Error(`apt-get update failed (${errorMessage(error)})`, {
      cause: error,
    });
  }
  await runner.asRoot(aptInstall(BASE_PACKAGES), 'install base packages');
}

/**
 * Install sequentially. Each toolchain is isolated: an error marks it failed
 * and the next one still runs, like the per-component subshell in the bash script.
 */
export async function executePlan(
  plan: readonly PlannedToolchain[],
  deps: ExecuteDeps,
): Promise<ExecutionResult> {
  const result: ExecutionResult = { ok: [], failed: [], warnings: [] };
  for (const { toolchain, choices, yes, skipReason } of plan) {
    const { id } = toolchain;
    deps.logger.log(`[${id}] ${toolchain.label}`);
    if (skipReason) {
      result.failed.push(id);
      deps.logger.error(`component failed: ${id}: ${skipReason}`);
      continue;
    }
    const ic = createInstallContext({
      runner: deps.runner,
      ctx: deps.ctx,
      logger: deps.logger,
      yes,
      fetch: deps.fetch,
      exists: deps.exists,
      listDir: deps.listDir,
    });
    try {
      await toolchain.install(ic, choices);
      result.ok.push(id);
    } catch (error) {
      result.failed.push(id);
      deps.logger.error(`component failed: ${id}: ${errorMessage(error)}`);
    }
    result.warnings.push(...ic.warnings.map((message) => ({ id, message })));
  }
  return result;
}

export const RELOGIN_NOTE =
  'Log out and back in (or open a new shell) so PATH and the docker group take effect.';

/** Same layout as the bash script's summary, plus collected add-on warnings. */
export function printSummary(
  result: ExecutionResult,
  logger: Logger,
  out: TextSink,
): void {
  out.write('\n');
  logger.log('Summary');
  if (result.ok.length) out.write(`  ok:       ${result.ok.join(' ')}\n`);
  if (result.failed.length)
    out.write(`  failed:   ${chalk.red(result.failed.join(' '))}\n`);
  if (result.warnings.length) {
    out.write('  warnings:\n');
    for (const w of result.warnings)
      out.write(`    ${chalk.yellow('-')} ${w.id}: ${w.message}\n`);
  }
  out.write(`\n${RELOGIN_NOTE}\n`);
}
