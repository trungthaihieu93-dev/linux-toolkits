import { execFile } from 'node:child_process';
import type { TextSink } from './start';

/**
 * Open `url` with xdg-open (argv, no shell). Failures are reported, never
 * fatal: the URL is already printed.
 */
export function openBrowser(url: string, err: TextSink): void {
  try {
    const child = execFile('xdg-open', [url], { timeout: 15_000 }, (error) => {
      if (error) {
        err.write(
          `td: could not open a browser (${error.message}); open the URL above\n`,
        );
      }
    });
    child.unref();
  } catch (error) {
    err.write(
      `td: could not open a browser (${error instanceof Error ? error.message : String(error)})\n`,
    );
  }
}
