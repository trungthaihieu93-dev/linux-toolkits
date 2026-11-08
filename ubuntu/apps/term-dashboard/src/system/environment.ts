import { access, constants } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

export type Env = Readonly<Record<string, string | undefined>>;

/** The folders td reads and writes, resolved once from the environment. */
export interface Dirs {
  home: string;
  /** `$XDG_CONFIG_HOME` or `~/.config`. */
  configHome: string;
  /** `$XDG_STATE_HOME` or `~/.local/state`. */
  stateHome: string;
  /** `$XDG_DATA_HOME` or `~/.local/share`. */
  dataHome: string;
  /** `$XDG_DATA_DIRS` or `/usr/local/share:/usr/share`. */
  dataDirs: string[];
  /** `<stateHome>/term-dashboard/backups`. */
  backups: string;
}

/** An XDG variable is used only when it holds an absolute path. */
function xdg(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value && isAbsolute(value) ? value : fallback;
}

export function resolveDirs(env: Env, home: string): Dirs {
  const stateHome = xdg(env, 'XDG_STATE_HOME', join(home, '.local', 'state'));
  const dataDirs = (env['XDG_DATA_DIRS'] || '/usr/local/share:/usr/share')
    .split(':')
    .filter((d) => isAbsolute(d));
  return {
    home,
    configHome: xdg(env, 'XDG_CONFIG_HOME', join(home, '.config')),
    stateHome,
    dataHome: xdg(env, 'XDG_DATA_HOME', join(home, '.local', 'share')),
    dataDirs,
    backups: join(stateHome, 'term-dashboard', 'backups'),
  };
}

/** Absolute path of an executable on `PATH` (read-only probe, no process). */
export async function findExecutable(
  name: string,
  env: Env,
): Promise<string | null> {
  if (name.includes('/')) {
    return (await isExecutable(name)) ? name : null;
  }
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
