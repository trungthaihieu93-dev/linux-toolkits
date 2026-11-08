import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LOOPBACK } from './listen';

/** What a running td records so a second td can reuse it. */
export interface InstanceInfo {
  port: number;
  pid: number;
  instanceSecret: string;
}

/**
 * `$XDG_RUNTIME_DIR/term-dashboard/instance.json`, or
 * `~/.local/state/term-dashboard/instance.json` without XDG_RUNTIME_DIR.
 */
export function instanceFilePath(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const runtime = env['XDG_RUNTIME_DIR'];
  const base =
    runtime && runtime.startsWith('/')
      ? runtime
      : join(home, '.local', 'state');
  return join(base, 'term-dashboard', 'instance.json');
}

function parseInstance(text: string): InstanceInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { port, pid, instanceSecret } = data as Record<string, unknown>;
  const isPort = (v: unknown): v is number =>
    Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536;
  const isPid = (v: unknown): v is number =>
    Number.isInteger(v) && (v as number) > 0;
  if (!isPort(port) || !isPid(pid)) return null;
  if (
    typeof instanceSecret !== 'string' ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(instanceSecret)
  ) {
    return null;
  }
  return { port, pid, instanceSecret };
}

/** Write the instance file atomically: folder 0700, file 0600. */
export async function writeInstanceFile(
  file: string,
  info: InstanceInfo,
): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(info)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Read the instance file, trusting it only when it is a regular file owned by
 * `uid` with mode 0600 and well-formed contents. Anything else returns null.
 */
export async function readInstanceFile(
  file: string,
  uid: number,
): Promise<InstanceInfo | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600) {
      return null;
    }
    return parseInstance(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Delete the instance file if it still belongs to `pid`. */
export async function removeInstanceFile(
  file: string,
  pid: number,
  uid: number,
): Promise<void> {
  const current = await readInstanceFile(file, uid);
  if (current?.pid === pid) await rm(file, { force: true });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface InstanceProbeDeps {
  uid: number;
  fetch: typeof fetch;
  isAlive: (pid: number) => boolean;
  timeoutMs?: number;
}

const baseUrl = (port: number) => `http://${LOOPBACK}:${port}`;

/**
 * The running td described by `file`, or null. It counts only when the file is
 * trusted, its pid is alive, and `/api/health` on its port reports that pid; a
 * process answering on the port without a matching file is never trusted.
 */
export async function findRunningInstance(
  file: string,
  deps: InstanceProbeDeps,
): Promise<InstanceInfo | null> {
  const info = await readInstanceFile(file, deps.uid);
  if (!info || !deps.isAlive(info.pid)) return null;
  try {
    const res = await deps.fetch(`${baseUrl(info.port)}/api/health`, {
      signal: AbortSignal.timeout(deps.timeoutMs ?? 2000),
    });
    if (!res.ok) return null;
    const health = (await res.json()) as { app?: unknown; pid?: unknown };
    return health.app === 'term-dashboard' && health.pid === info.pid
      ? info
      : null;
  } catch {
    return null;
  }
}

/** Ask the running instance for a fresh launch code. */
export async function requestLaunchCode(
  info: InstanceInfo,
  fetchFn: typeof fetch,
  timeoutMs = 2000,
): Promise<string> {
  const res = await fetchFn(`${baseUrl(info.port)}/api/launch-code`, {
    method: 'POST',
    headers: { authorization: `Bearer ${info.instanceSecret}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`running td refused a launch code (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { code?: unknown };
  if (typeof body.code !== 'string' || body.code.length === 0) {
    throw new Error('running td returned no launch code');
  }
  return body.code;
}
