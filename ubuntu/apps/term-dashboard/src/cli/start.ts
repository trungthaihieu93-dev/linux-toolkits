import { createApp } from '../server/app';
import {
  SIGNAL_EXIT_CODES,
  type CleanupRegistry,
  type SignalSource,
} from '../server/cleanup';
import type { AccessPolicy } from '../server/guard';
import {
  findRunningInstance,
  removeInstanceFile,
  requestLaunchCode,
  writeInstanceFile,
} from '../server/instance';
import {
  LOOPBACK,
  listen,
  PortInUseError,
  type RunningServer,
} from '../server/listen';
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
  openUrl: (url: string) => void;
  signals: SignalSource;
  cleanups: CleanupRegistry;
  /** Called on a second signal while shutdown is still running. */
  forceExit: (code: number) => void;
}

export const EXIT = { ok: 0, error: 1, usage: 2 } as const;

export function launchUrl(origin: string, code: string): string {
  return `${origin}/#c=${code}`;
}

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

  const open = (url: string) => {
    if (opts.open && deps.canOpenBrowser) deps.openUrl(url);
  };

  const running = await findRunningInstance(deps.instanceFile, deps);
  if (running) {
    try {
      const code = await requestLaunchCode(running, deps.fetch);
      const url = launchUrl(`http://${LOOPBACK}:${running.port}`, code);
      out.write(`td already running (pid ${running.pid})\n${url}\n`);
      open(url);
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
  const app = createApp({
    session,
    policy,
    version: deps.version,
    pid: deps.pid,
    webRoot: deps.webRoot,
  });

  let server: RunningServer;
  try {
    server = await listen(app.fetch, opts.port);
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

  const origin = opts.devOrigin?.origin ?? `http://${LOOPBACK}:${boundPort}`;
  const url = launchUrl(origin, session.mintLaunchCode());
  out.write(
    [
      `td ${deps.version} listening on http://${LOOPBACK}:${boundPort}`,
      `Open: ${url}`,
      `(single-use link, valid ${LAUNCH_CODE_TTL_MS / 1000} s; run td again for a new one)`,
      'Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );
  open(url);

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
