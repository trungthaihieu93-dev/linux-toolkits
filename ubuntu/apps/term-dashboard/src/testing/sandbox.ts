import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExecutable } from '../system/environment';

/**
 * A throwaway HOME with every XDG folder inside it and the keyfile gsettings
 * backend, so specs that run real programs never touch the user's dotfiles
 * or dconf database. Pass `env` to every runner and child process.
 */
export interface Sandbox {
  root: string;
  home: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

export async function createSandbox(prefix = 'td-sbx-'): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, 'home');
  const env: Record<string, string> = {
    HOME: home,
    USER: process.env['USER'] ?? 'td',
    LOGNAME: process.env['LOGNAME'] ?? 'td',
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_RUNTIME_DIR: join(root, 'run'),
    XDG_DATA_DIRS:
      process.env['XDG_DATA_DIRS'] || '/usr/local/share:/usr/share',
    GSETTINGS_BACKEND: 'keyfile',
  };
  for (const dir of [
    env['XDG_CONFIG_HOME'],
    env['XDG_STATE_HOME'],
    env['XDG_DATA_HOME'],
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await mkdir(env['XDG_RUNTIME_DIR'], { recursive: true, mode: 0o700 });
  return {
    root,
    home,
    env,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** True when every binary is on PATH (for `it.skipIf`). */
export async function haveBinaries(...names: string[]): Promise<boolean> {
  for (const name of names) {
    if ((await findExecutable(name, process.env)) === null) return false;
  }
  return true;
}

/** `pgrep -s <sid>` exit status: 0 when a process remains, 1 when none. */
export function pgrepSession(sid: number): number {
  try {
    execFileSync('pgrep', ['-s', String(sid)], { stdio: 'ignore' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

/** Resolves once `pred` holds, polling every 20 ms. */
export async function until(
  pred: () => boolean | Promise<boolean>,
  ms = 5000,
  what = 'condition',
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
