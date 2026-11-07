import {
  DryRunRunner,
  hasApt,
  hasCommand,
  logger,
  ProcessRunner,
  resolveContext,
} from '@linux-toolchain/core';
import { catalog } from '@linux-toolchain/toolchains';
import { run } from './cli/program';
import { inquirerPrompts } from './cli/prompts';

run(process.argv.slice(2), {
  catalog,
  platform: process.platform,
  tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prompts: inquirerPrompts,
  out: process.stdout,
  err: process.stderr,
  logger,
  resolveContext: (user) => resolveContext({ user }),
  hasApt: () => hasApt(),
  hasCurl: () => hasCommand('curl'),
  createRunner: (ctx, dryRun) =>
    dryRun ? new DryRunRunner(process.stdout) : new ProcessRunner(ctx),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
