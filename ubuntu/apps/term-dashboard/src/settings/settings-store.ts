import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { Settings, SettingsUpdate } from '@linux-toolchain/term-config';
import { DEFAULT_PORT } from '../cli/program';
import { badRequest } from '../errors';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  theme: 'dark',
  port: DEFAULT_PORT,
};

const MAX_SETTINGS_BYTES = 64 * 1024;

const isPort = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 65535;
const isTheme = (v: unknown): v is Settings['theme'] =>
  v === 'dark' || v === 'light';
const isShellPath = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 4096 &&
  isAbsolute(v) &&
  !/[\0\n]/.test(v);

/**
 * Validate a partial update. Unknown fields and wrong types are errors; an
 * explicit `terminalShell: null` or `''` clears it (returned as undefined).
 */
export function parseSettingsUpdate(
  body: unknown,
): SettingsUpdate & { clearTerminalShell?: true } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest('expected a settings object');
  }
  const out: SettingsUpdate & { clearTerminalShell?: true } = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'theme') {
      if (!isTheme(value)) throw badRequest('theme must be "dark" or "light"');
      out.theme = value;
    } else if (key === 'port') {
      if (!isPort(value)) throw badRequest('port must be an integer 0-65535');
      out.port = value;
    } else if (key === 'terminalShell') {
      if (value === null || value === '') out.clearTerminalShell = true;
      else if (isShellPath(value)) out.terminalShell = value;
      else throw badRequest('terminalShell must be an absolute path');
    } else {
      throw badRequest(`unknown setting ${JSON.stringify(key)}`);
    }
  }
  return out;
}

/** Settings from parsed JSON; invalid fields fall back to their defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const obj =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const settings: Settings = {
    theme: isTheme(obj['theme']) ? obj['theme'] : DEFAULT_SETTINGS.theme,
    port: isPort(obj['port']) ? obj['port'] : DEFAULT_SETTINGS.port,
  };
  if (isShellPath(obj['terminalShell'])) {
    settings.terminalShell = obj['terminalShell'];
  }
  return settings;
}

/** `$XDG_CONFIG_HOME/term-dashboard/settings.json`, written atomically. */
export class SettingsStore {
  readonly path: string;

  constructor(configHome: string) {
    this.path = join(configHome, 'term-dashboard', 'settings.json');
  }

  async read(): Promise<Settings> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
    if (text.length > MAX_SETTINGS_BYTES) return { ...DEFAULT_SETTINGS };
    try {
      return normalizeSettings(JSON.parse(text));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async update(body: unknown): Promise<Settings> {
    const { clearTerminalShell, ...update } = parseSettingsUpdate(body);
    const next: Settings = { ...(await this.read()), ...update };
    if (clearTerminalShell) delete next.terminalShell;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(tmp, this.path);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    return next;
  }
}
