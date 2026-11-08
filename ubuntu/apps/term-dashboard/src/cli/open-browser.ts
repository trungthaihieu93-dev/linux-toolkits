import { execFile } from 'node:child_process';
import type { TextSink } from './start';

/**
 * Open `url` with xdg-open (argv, no shell). Callers pass the `file://` URL
 * of a private launch page, never a URL that carries a launch code: argv is
 * readable by every local user. Failures are reported, never fatal: the
 * launch URL is already printed.
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
