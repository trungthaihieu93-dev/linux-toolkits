import { accessSync, constants, readFileSync } from 'node:fs';
import { machine } from 'node:os';
import { delimiter, join } from 'node:path';

export function isLinux(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux';
}

/** True if `cmd` is an executable file on PATH (like `command -v`). */
export function hasCommand(
  cmd: string,
  pathEnv: string = process.env['PATH'] ?? '',
  isExecutable: (file: string) => boolean = defaultIsExecutable,
): boolean {
  if (!cmd || cmd.includes('/')) return false;
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => isExecutable(join(dir, cmd)));
}

function defaultIsExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function hasApt(
  check: (cmd: string) => boolean = (cmd) => hasCommand(cmd),
): boolean {
  return check('apt-get');
}

/** Parse /etc/os-release (KEY=VALUE, optional single/double quotes) into a map. */
export function osRelease(
  read: () => string = () => readFileSync('/etc/os-release', 'utf8'),
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of read().split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1);
    const quote = value[0];
    if (
      (quote === '"' || quote === "'") &&
      value.endsWith(quote) &&
      value.length >= 2
    ) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\(["\\$`])/g, '$1');
    }
    result[key] = value;
  }
  return result;
}

/** Map the kernel machine name to a Debian-style architecture (amd64, arm64). */
export function arch(machineName: string = machine()): 'amd64' | 'arm64' {
  switch (machineName) {
    case 'x86_64':
      return 'amd64';
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    default:
      throw new Error(`unsupported architecture: ${machineName}`);
  }
}
