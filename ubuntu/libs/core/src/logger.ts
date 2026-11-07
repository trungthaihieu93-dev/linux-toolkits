import chalk from 'chalk';

/** Writable sink; process.stdout / process.stderr satisfy it. */
export interface LogSink {
  write(chunk: string): unknown;
}

export interface Logger {
  /** `==> msg` to stdout (blue bold marker). */
  log(message: string): void;
  /** `[warn] msg` to stderr (yellow bold marker). */
  warn(message: string): void;
  /** `[error] msg` to stderr (red bold marker). */
  error(message: string): void;
}

/** Same styling as log/warn/err in install-toolchains.sh. Honours NO_COLOR via chalk. */
export function createLogger(out: LogSink = process.stdout, err: LogSink = process.stderr): Logger {
  return {
    log: (message) => void out.write(`${chalk.blue.bold('==>')} ${message}\n`),
    warn: (message) => void err.write(`${chalk.yellow.bold('[warn]')} ${message}\n`),
    error: (message) => void err.write(`${chalk.red.bold('[error]')} ${message}\n`),
  };
}

export const logger: Logger = createLogger();
