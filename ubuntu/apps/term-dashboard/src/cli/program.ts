import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { EXIT, type StartOptions, type TextSink } from './start';

export const DEFAULT_PORT = 4777;

export interface ProgramDeps {
  out: TextSink;
  err: TextSink;
  start: (opts: StartOptions) => Promise<number>;
}

export function parsePort(value: string): number {
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new InvalidArgumentError('expected a port number from 0 to 65535');
  }
  return Number(value);
}

/** `--dev-origin` accepts only an http(s) origin on the loopback interface. */
export function parseDevOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidArgumentError(
      'expected an origin such as http://localhost:5173',
    );
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!/^https?:$/.test(url.protocol) || !loopback || url.pathname !== '/') {
    throw new InvalidArgumentError(
      'expected an http origin on localhost or 127.0.0.1, without a path',
    );
  }
  return url;
}

interface Flags {
  port: number;
  open: boolean;
  devOrigin?: URL;
}

/**
 * Parse `argv` (user arguments only, without node and script path) and run
 * td. Never calls process.exit; returns the exit code instead.
 */
export async function run(
  argv: readonly string[],
  deps: ProgramDeps,
): Promise<number> {
  let code: number = EXIT.ok;
  const program = new Command()
    .name('td')
    .description(pkg.description)
    .version(pkg.version, '-v, --version', 'print the td version')
    .option(
      '--port <n>',
      'port on 127.0.0.1 (0 picks a free port)',
      parsePort,
      DEFAULT_PORT,
    )
    .option('--no-open', 'print the launch URL without opening a browser')
    .addOption(
      new Option('--dev-origin <url>', 'accept the Vite dev server origin')
        .argParser(parseDevOrigin)
        .hideHelp(),
    )
    .exitOverride()
    .configureOutput({
      writeOut: (s) => void deps.out.write(s),
      writeErr: (s) => void deps.err.write(s),
    })
    .showHelpAfterError('(run td --help for usage)')
    .addHelpText(
      'after',
      [
        '',
        'td starts a dashboard server on 127.0.0.1 and opens a single-use launch',
        'URL in the browser. If td is already running, it opens that instance.',
        '',
        'Exit codes: 0 success, 1 error, 2 usage error; 129/130/143 after',
        'SIGHUP/SIGINT/SIGTERM.',
      ].join('\n'),
    )
    .action(async (flags: Flags) => {
      code = await deps.start({
        port: flags.port,
        open: flags.open,
        ...(flags.devOrigin ? { devOrigin: flags.devOrigin } : {}),
      });
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return code;
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version exit 0; every other commander error is a usage error.
      return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    }
    throw error;
  }
}
