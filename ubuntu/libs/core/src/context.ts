import { execFileSync } from 'node:child_process';

/** Who the installers act for and how commands are elevated. */
export interface Context {
  /** True when the CLI itself runs as root (e.g. `sudo npx ...`). */
  isRoot: boolean;
  /** Target (non-root) user that user-level tools are installed for. */
  user: string;
  /** Target user's home directory, from the passwd database. */
  home: string;
}

/**
 * Prelude for every command run as the target user: tool dirs on PATH, nvm
 * loaded. Identical to USER_ENV in install-toolchains.sh.
 */
export const USER_ENV =
  'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh";';

export interface ResolveContextOptions {
  /** Value of `--user`; only allowed when running as root (or with `dryRun`). */
  user?: string;
  /**
   * Nothing will be executed, so a non-root caller may preview `--user NAME`:
   * the context targets NAME (looked up as usual) with isRoot false.
   */
  dryRun?: boolean;
  getuid?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Returns the `getent passwd <key>` line for a name or uid, or undefined. */
  getent?: (key: string) => string | undefined;
}

export function getentPasswd(key: string): string | undefined {
  try {
    const out = execFileSync('getent', ['passwd', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

function defaultGetuid(): number {
  if (typeof process.getuid !== 'function') {
    throw new Error(
      'this platform has no user ids; linux-toolchain needs Linux',
    );
  }
  return process.getuid();
}

function lookup(
  getent: (key: string) => string | undefined,
  key: string,
  notFound: string,
): { user: string; home: string } {
  const fields = getent(key)?.split(':');
  const user = fields?.[0];
  const home = fields?.[5];
  if (!user) throw new Error(notFound);
  if (!home) throw new Error(`no home directory for user: ${user}`);
  return { user, home };
}

const NO_TARGET =
  'no non-root target user; run via sudo from your account or pass --user NAME';

export function resolveContext(opts: ResolveContextOptions = {}): Context {
  const getuid = opts.getuid ?? defaultGetuid;
  const env = opts.env ?? process.env;
  const getent = opts.getent ?? getentPasswd;
  const uid = getuid();

  if (uid !== 0) {
    if (opts.user && opts.dryRun) {
      const target = lookup(getent, opts.user, `user not found: ${opts.user}`);
      if (target.user === 'root') throw new Error(NO_TARGET);
      return { isRoot: false, ...target };
    }
    if (opts.user)
      throw new Error('--user needs root (run with sudo, or drop --user)');
    const { user, home } = lookup(
      getent,
      String(uid),
      `cannot resolve the current user (uid ${uid})`,
    );
    return { isRoot: false, user, home };
  }

  const target = opts.user || env['SUDO_USER'] || '';
  if (!target || target === 'root') throw new Error(NO_TARGET);
  const { user, home } = lookup(getent, target, `user not found: ${target}`);
  if (user === 'root') throw new Error(NO_TARGET);
  return { isRoot: true, user, home };
}
