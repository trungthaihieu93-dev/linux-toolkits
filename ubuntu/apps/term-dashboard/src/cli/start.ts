import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app';
import {
  SIGNAL_EXIT_CODES,
  type CleanupRegistry,
  type SignalSource,
} from '../server/cleanup';
import type { AccessPolicy } from '../server/guard';
import {
  isLaunchPagePath,
  LaunchPages,
  launchUrl,
} from '../server/launch-page';
import {
  findRunningInstance,
  removeInstanceFile,
  requestLaunchCode,
  writeInstanceFile,
} from '../server/instance';
import {
  createWebSocketServer,
  LOOPBACK,
  listen,
  PortInUseError,
  type RunningServer,
} from '../server/listen';
import type { Services } from '../server/services';
import { createSessionStore, LAUNCH_CODE_TTL_MS } from '../server/session';

export interface TextSink {
  write(chunk: string): unknown;
}

export interface StartOptions {
  port: number;
  open: boolean;
  /** Vite dev server origin, accepted alongside the server's own origin. */
  devOrigin?: URL;
}

export interface StartDeps {
  out: TextSink;
  err: TextSink;
  uid: number;
  pid: number;
  version: string;
  instanceFile: string;
  webRoot: string | null;
  fetch: typeof fetch;
  isAlive: (pid: number) => boolean;
  /** Whether a graphical session exists to open a browser in. */
  canOpenBrowser: boolean;
  /**
   * Opens a `file://` URL of a private launch page in the browser. The launch
   * code itself is never passed, since process argv is world-readable.
   */
  openUrl: (url: string) => void;
  signals: SignalSource;
  cleanups: CleanupRegistry;
  /** Called on a second signal while shutdown is still running. */
  forceExit: (code: number) => void;
  /** Builds the backend services; without it only the server shell runs. */
  createServices?: () => Services;
}

export const EXIT = { ok: 0, error: 1, usage: 2 } as const;

export { launchUrl };

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Start the dashboard server, or hand over to the instance that is already
 * running. Resolves with the exit code once the server has shut down (on
 * SIGINT, SIGTERM or SIGHUP) or immediately when nothing was started.
 */
export async function startServer(
  opts: StartOptions,
  deps: StartDeps,
): Promise<number> {
  const { out, err } = deps;
  if (deps.uid === 0) {
    err.write(
      'td: refusing to start the server as root; run td as your normal user\n',
    );
    return EXIT.error;
  }

  const wantBrowser = opts.open && deps.canOpenBrowser;
  // Launch pages live next to the instance file: $XDG_RUNTIME_DIR/term-dashboard
  // or, without XDG_RUNTIME_DIR, the 0700 state folder.
  const pageDir = dirname(deps.instanceFile);
  const openPage = (page: string) => deps.openUrl(pathToFileURL(page).href);
  const noPage = (why: string) =>
    err.write(
      `td: not opening a browser (${why}); open the URL above yourself\n`,
    );

  const running = await findRunningInstance(deps.instanceFile, deps);
  if (running) {
    try {
      const { code, page } = await requestLaunchCode(running, deps.fetch, {
        page: wantBrowser,
      });
      const url = launchUrl(`http://${LOOPBACK}:${running.port}`, code);
      out.write(`td already running (pid ${running.pid})\n${url}\n`);
      if (wantBrowser) {
        if (page !== undefined && (await isOwnPage(pageDir, page, deps.uid))) {
          openPage(page);
        } else {
          noPage('the running td did not create a private launch page');
        }
      }
      return EXIT.ok;
    } catch (error) {
      err.write(
        `td: could not reach the running instance: ${message(error)}\n`,
      );
      return EXIT.error;
    }
  }

  let boundPort = opts.port;
  const policy: AccessPolicy = {
    port: () => boundPort,
    devOrigin: opts.devOrigin,
  };
  const session = createSessionStore();
  const launchPages = new LaunchPages(pageDir, LAUNCH_CODE_TTL_MS);
  const services = deps.createServices?.();
  const app = createApp({
    session,
    policy,
    version: deps.version,
    pid: deps.pid,
    webRoot: deps.webRoot,
    services,
    launchPages,
    notice: (line) => err.write(`${line}\n`),
  });

  let server: RunningServer;
  try {
    server = await listen(
      app.fetch,
      opts.port,
      services ? createWebSocketServer() : undefined,
    );
  } catch (error) {
    if (error instanceof PortInUseError) {
      err.write(
        `td: port ${error.port} is in use by another program; choose one with --port <n> (0 picks a free port)\n`,
      );
    } else {
      err.write(`td: could not start the server: ${message(error)}\n`);
    }
    return EXIT.error;
  }
  boundPort = server.port;

  try {
    await writeInstanceFile(deps.instanceFile, {
      port: boundPort,
      pid: deps.pid,
      instanceSecret: session.instanceSecret,
    });
  } catch (error) {
    await server.close();
    err.write(`td: could not write ${deps.instanceFile}: ${message(error)}\n`);
    return EXIT.error;
  }
  deps.cleanups.register(() =>
    removeInstanceFile(deps.instanceFile, deps.pid, deps.uid),
  );
  deps.cleanups.register(() => server.close());
  deps.cleanups.register(() => launchPages.removeAll());
  // Registered last, so it runs first: terminals end before the server stops.
  if (services) deps.cleanups.register(() => services.close());

  const origin = opts.devOrigin?.origin ?? `http://${LOOPBACK}:${boundPort}`;
  const code = session.mintLaunchCode();
  const url = launchUrl(origin, code);
  let page: string | null = null;
  let pageError: string | null = null;
  if (wantBrowser) {
    try {
      page = await launchPages.create(code, url);
    } catch (error) {
      pageError = `could not write a private launch page: ${message(error)}`;
    }
  }
  out.write(
    [
      `td ${deps.version} listening on http://${LOOPBACK}:${boundPort}`,
      `Open: ${url}`,
      `(single-use link, valid ${LAUNCH_CODE_TTL_MS / 1000} s; run td again for a new one)`,
      'Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );
  if (page !== null) openPage(page);
  else if (pageError !== null) noPage(pageError);

  return new Promise<number>((resolve) => {
    let stopping = false;
    const unsubscribe = deps.signals((signal) => {
      const code = SIGNAL_EXIT_CODES[signal];
      if (stopping) {
        deps.forceExit(code);
        return;
      }
      stopping = true;
      err.write(`\ntd: ${signal}, shutting down\n`);
      void deps.cleanups.runAll().finally(() => {
        unsubscribe();
        resolve(code);
      });
    });
  });
}

/**
 * A launch page path from the running td is opened only when it is a page
 * name in our page folder, and a regular 0600 file owned by us.
 */
async function isOwnPage(
  dir: string,
  page: string,
  uid: number,
): Promise<boolean> {
  if (!isLaunchPagePath(dir, page)) return false;
  try {
    const info = await lstat(page);
    return info.isFile() && info.uid === uid && (info.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}
