import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { openBrowser } from './cli/open-browser';
import { run } from './cli/program';
import { startServer } from './cli/start';
import { createCleanupRegistry, processSignals } from './server/cleanup';
import { instanceFilePath, isProcessAlive } from './server/instance';
import { createServices } from './server/services';

/** Grace period for cleanups before the process is forced down. */
const SHUTDOWN_GRACE_MS = 5000;

run(process.argv.slice(2), {
  out: process.stdout,
  err: process.stderr,
  start: (opts) =>
    startServer(opts, {
      out: process.stdout,
      err: process.stderr,
      uid: process.getuid?.() ?? -1,
      pid: process.pid,
      version: pkg.version,
      instanceFile: instanceFilePath(process.env, homedir()),
      // The built web UI sits in web/ next to main.js.
      webRoot: fileURLToPath(new URL('./web/', import.meta.url)),
      fetch: globalThis.fetch,
      isAlive: isProcessAlive,
      canOpenBrowser: Boolean(
        process.env['DISPLAY'] || process.env['WAYLAND_DISPLAY'],
      ),
      openUrl: (url) => openBrowser(url, process.stderr),
      signals: processSignals,
      cleanups: createCleanupRegistry(),
      forceExit: (code) => process.exit(code),
      createServices: () =>
        createServices({ env: process.env, home: homedir() }),
    }),
})
  .then((code) => {
    process.exitCode = code;
    // Lingering handles (keep-alive sockets, children) must not keep td alive
    // after shutdown.
    setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS).unref();
  })
  .catch((error: unknown) => {
    console.error(
      `td: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
