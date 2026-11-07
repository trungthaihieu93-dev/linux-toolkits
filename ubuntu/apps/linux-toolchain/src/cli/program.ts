import { Command, CommanderError } from 'commander';
import type { TextSink } from '@linux-toolchain/core';
import pkg from '../../package.json' with { type: 'json' };
import { EXIT, runInstall, type InstallDeps } from './install';
import { listJson, listText } from './list';
import { isPromptAbort } from './prompts';
import { parseRunConfig, UsageError, type InstallFlags } from './options';

export interface ProgramDeps extends InstallDeps {
  err: TextSink;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Install flags, shared by the root command and its `install` alias. */
function withInstallOptions(cmd: Command): Command {
  return cmd
    .argument(
      '[ids...]',
      'toolchain ids (comma or space separated); see `list`',
    )
    .option('--all', 'select every toolchain')
    .option('--only <ids>', 'comma-separated toolchain ids (same as [ids...])')
    .option(
      '--opt <key=value>',
      'set a sub-option, repeatable (e.g. --opt java.jdk=17,21 --opt java.addons=maven,gradle)',
      collect,
    )
    .option(
      '--defaults',
      'accept defaults for every sub-option (no option prompts)',
    )
    .option('--user <name>', 'target user (only when running as root)')
    .option('-y, --yes', 'skip confirmations, incl. the Android SDK licenses')
    .option(
      '--dry-run',
      'print the root/user scripts that would run; change nothing',
    );
}

/**
 * Parse `argv` (user arguments only, without node and script path) and run the
 * matching command. Never calls process.exit; returns the exit code instead.
 */
export async function run(
  argv: readonly string[],
  deps: ProgramDeps,
): Promise<number> {
  let code: number = EXIT.ok;
  const install = async (ids: string[], flags: InstallFlags) => {
    code = await runInstall(parseRunConfig(ids, flags, deps.catalog), deps);
  };

  const program = new Command()
    .name('linux-toolchain')
    .description(pkg.description)
    .version(pkg.version, '-v, --version', 'print the CLI version')
    .exitOverride()
    .configureOutput({
      writeOut: (s) => void deps.out.write(s),
      writeErr: (s) => void deps.err.write(s),
    })
    .showHelpAfterError('(run linux-toolchain --help for usage)')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  linux-toolchain                                   pick toolchains interactively',
        '  linux-toolchain --only java,go --opt java.jdk=17,21 --opt java.addons=maven,gradle -y',
        '  linux-toolchain --all --defaults --dry-run',
        '  linux-toolchain list --json',
        '',
        'Exit codes: 0 success, 1 a toolchain failed, 2 usage error, 130 cancelled.',
      ].join('\n'),
    );
  withInstallOptions(program).action(install);

  withInstallOptions(
    program
      .command('install')
      .description('install toolchains (the default command)'),
  ).action(install);

  program
    .command('list')
    .description('list toolchain ids, options and add-ons')
    .option('--json', 'print JSON')
    .action((flags: { json?: boolean }) => {
      deps.out.write(
        flags.json ? listJson(deps.catalog) : listText(deps.catalog),
      );
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return code;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version exit 0; every other commander error is a usage error.
      return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    }
    if (error instanceof UsageError) {
      deps.logger.error(
        `${error.message} (run linux-toolchain --help for usage)`,
      );
      return EXIT.usage;
    }
    if (isPromptAbort(error)) {
      deps.logger.error('cancelled');
      return EXIT.aborted;
    }
    throw error;
  }
}
