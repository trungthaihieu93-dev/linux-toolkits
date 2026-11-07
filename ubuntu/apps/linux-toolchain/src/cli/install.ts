import chalk from 'chalk';
import type { Context, Logger, Runner, TextSink } from '@linux-toolchain/core';
import {
  createInstallContext,
  resolveSelection,
  type Choices,
  type InstallContextInit,
  type Toolchain,
} from '@linux-toolchain/toolchains';
import {
  executePlan,
  errorMessage,
  prepareSystem,
  printSummary,
  renderReview,
  type PlannedToolchain,
} from './execute';
import type { RunConfig } from './options';
import {
  ANDROID_LICENSE_QUESTION,
  promptChoices,
  promptToolchains,
  resolveChoices,
  type PromptFns,
} from './prompts';

/** A Runner that may hold resources (ProcessRunner's sudo refresh timer). */
export type ClosableRunner = Runner & { close?(): void };

/** Everything runInstall touches outside its arguments; main.ts wires the real ones. */
export interface InstallDeps {
  catalog: readonly Toolchain[];
  platform: NodeJS.Platform;
  /** stdin and stdout are both TTYs. */
  tty: boolean;
  prompts: PromptFns;
  out: TextSink;
  logger: Logger;
  /** Throws on an invalid target (e.g. --user without root); `dryRun` lets a non-root caller preview --user. */
  resolveContext(user: string | undefined, dryRun: boolean): Context;
  hasApt(): boolean;
  hasCurl(): boolean;
  createRunner(ctx: Context, dryRun: boolean): ClosableRunner;
  fetch?: InstallContextInit['fetch'];
  exists?: InstallContextInit['exists'];
  listDir?: InstallContextInit['listDir'];
}

export const NO_TTY_MESSAGE = 'no TTY for the menu; use --all or --only id,id';
export const LICENSES_DECLINED = 'licenses not accepted';
export const BUN_TOOLS_NEEDS_BUN =
  'bun-tools needs bun: drop --opt nvm-bun.bun=false or deselect bun-tools';
const ANDROID = 'android';

/** Exit codes: 0 success, 1 install failure, 2 usage error, 130 aborted with Ctrl+C. */
export const EXIT = { ok: 0, failed: 1, usage: 2, aborted: 130 } as const;

/**
 * Collect choices for `initial` and every toolchain the selection rules add,
 * asking interactively when allowed. Choices are gathered before the rules
 * run so chosen add-ons (java jenv, flutter android-sdk) can add components.
 */
async function collectChoices(
  initial: readonly string[],
  config: RunConfig,
  interactive: boolean,
  probes: Parameters<typeof resolveSelection>[2],
  deps: InstallDeps,
): Promise<{ ids: string[]; choices: Map<string, Choices> }> {
  const byId = new Map(deps.catalog.map((t) => [t.id, t]));
  const choices = new Map<string, Choices>();
  const printed = new Set<string>();
  let batch = [...initial];
  let ids = [...initial];

  while (batch.length > 0) {
    const total = choices.size + batch.length;
    for (const id of batch) {
      const toolchain = byId.get(id) as Toolchain;
      const overrides = config.overrides.get(id) ?? {};
      if (interactive && toolchain.options.length > 0) {
        deps.out.write(
          `\n${chalk.bold.cyan(`${toolchain.label} (${choices.size + 1}/${total})`)}\n`,
        );
        choices.set(
          id,
          await promptChoices(toolchain, overrides, deps.prompts),
        );
      } else {
        choices.set(id, resolveChoices(toolchain, overrides));
      }
    }

    const selection = await resolveSelection(
      ids,
      choices,
      probes,
      deps.catalog,
    );
    for (const note of selection.notes) {
      if (printed.has(note)) continue;
      printed.add(note);
      deps.logger.log(note);
    }
    ids = selection.ids;
    batch = ids.filter((id) => !choices.has(id));
  }
  return { ids, choices };
}

/**
 * Usage errors only detectable once the final selection and its choices are
 * known. Returns the message, or undefined when the selection is consistent.
 */
function selectionError(
  ids: readonly string[],
  choices: ReadonlyMap<string, Choices>,
  config: RunConfig,
): string | undefined {
  const unselected = [...config.overrides.keys()].filter(
    (id) => !ids.includes(id),
  );
  if (unselected.length > 0) {
    return `--opt for a toolchain that is not selected: ${unselected.join(', ')}; select it or drop the --opt`;
  }
  if (
    ids.includes('bun-tools') &&
    ids.includes('nvm-bun') &&
    choices.get('nvm-bun')?.['bun'] === false
  ) {
    return BUN_TOOLS_NEEDS_BUN;
  }
  return undefined;
}

async function runSelected(
  config: RunConfig,
  deps: InstallDeps,
  ctx: Context,
  runner: ClosableRunner,
): Promise<number> {
  const { logger } = deps;
  const interactive = deps.tty && !config.defaults && !config.yes;
  const canConfirm = deps.tty && !config.yes;

  let initial = config.ids;
  if (initial.length === 0) {
    if (!deps.tty) {
      logger.error(NO_TTY_MESSAGE);
      return EXIT.usage;
    }
    const picked = await promptToolchains(deps.catalog, deps.prompts);
    initial = deps.catalog.map((t) => t.id).filter((id) => picked.includes(id));
  }
  if (initial.length === 0) {
    logger.log('nothing selected');
    return EXIT.ok;
  }

  const probes = createInstallContext({
    runner,
    ctx,
    logger,
    fetch: deps.fetch,
    exists: deps.exists,
    listDir: deps.listDir,
  });
  const { ids, choices } = await collectChoices(
    initial,
    config,
    interactive,
    probes,
    deps,
  );
  const invalid = selectionError(ids, choices, config);
  if (invalid) {
    logger.error(`${invalid} (run linux-toolchain --help for usage)`);
    return EXIT.usage;
  }

  const plan: PlannedToolchain[] = [];
  for (const id of ids) {
    const toolchain = deps.catalog.find((t) => t.id === id) as Toolchain;
    const step: PlannedToolchain = {
      toolchain,
      choices: choices.get(id) as Choices,
      yes: config.yes,
    };
    // Without -y and a TTY, android runs with yes=false and fails with the
    // library's LICENSE_ERROR, which tells the user to re-run with -y.
    if (id === ANDROID && canConfirm) {
      const accepted = await deps.prompts.confirm({
        message: ANDROID_LICENSE_QUESTION,
        default: false,
      });
      if (accepted) step.yes = true;
      else step.skipReason = LICENSES_DECLINED;
    }
    plan.push(step);
  }

  deps.out.write('\n');
  logger.log(`Review (user: ${ctx.user}${config.dryRun ? ', dry run' : ''})`);
  deps.out.write(renderReview(plan));
  if (
    canConfirm &&
    !(await deps.prompts.confirm({ message: 'Proceed?', default: true }))
  ) {
    logger.log('nothing installed');
    return EXIT.ok;
  }

  if (config.dryRun)
    logger.log('Dry run: printing the scripts, nothing is executed');
  logger.log(`Installing for user: ${ctx.user}`);
  try {
    await prepareSystem(runner, deps.hasApt(), deps.hasCurl());
  } catch (error) {
    logger.error(errorMessage(error));
    return EXIT.failed;
  }

  const result = await executePlan(plan, {
    runner,
    ctx,
    logger,
    fetch: deps.fetch,
    exists: deps.exists,
    listDir: deps.listDir,
  });
  printSummary(result, logger, deps.out);
  return result.failed.length > 0 ? EXIT.failed : EXIT.ok;
}

/** The install command: preflight, selection, options, review, execution, summary. Returns the exit code. */
export async function runInstall(
  config: RunConfig,
  deps: InstallDeps,
): Promise<number> {
  const { logger } = deps;
  if (deps.platform !== 'linux') {
    logger.error(
      `linux-toolchain only runs on Linux (Debian/Ubuntu); this is ${deps.platform}`,
    );
    return EXIT.failed;
  }

  let ctx: Context;
  try {
    ctx = deps.resolveContext(config.user, config.dryRun);
  } catch (error) {
    // An unusable target user (--user without root, no SUDO_USER, unknown user) is a usage error.
    logger.error(errorMessage(error));
    return EXIT.usage;
  }
  if (!deps.hasApt()) {
    logger.warn('apt not found: components that need it will fail');
  }

  const runner = deps.createRunner(ctx, config.dryRun);
  try {
    return await runSelected(config, deps, ctx, runner);
  } finally {
    runner.close?.();
  }
}
