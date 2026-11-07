import { Command } from 'commander';
import chalk from 'chalk';
import { coreName } from '@linux-toolchain/core';
import { toolchainsName } from '@linux-toolchain/toolchains';
import pkg from '../package.json' with { type: 'json' };

const program = new Command()
  .name('linux-toolchain')
  .description(pkg.description)
  .version(pkg.version, '-v, --version', 'print the CLI version')
  .action(() => {
    console.log(
      `${chalk.bold('linux-toolchain')} ${pkg.version} (${coreName}, ${toolchainsName})`,
    );
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(
    chalk.red(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
});
