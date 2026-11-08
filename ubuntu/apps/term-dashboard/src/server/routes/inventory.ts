import { basename } from 'node:path';
import type { Hono } from 'hono';
import {
  API_PATHS,
  findBlock,
  MAIN_BLOCK,
  ohMyZshSourceLines,
  SHELL_FILE_IDS,
  SHELL_NAMES,
  TERMINAL_KINDS,
  type ShellInfo,
  type ShellName,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import { compareBackupTimestamps } from '../../files/file-store';
import { GHOSTTY_FILES } from '../../ghostty/ghostty-service';
import { configFileOf } from '../../shell/shell-service';
import { findExecutable } from '../../system/environment';
import type { Services } from '../services';

async function shellInfo(
  s: Services,
  shell: ShellName,
  loginShell: string | null,
): Promise<ShellInfo> {
  const binary = await findExecutable(shell, s.env);
  const ids = SHELL_FILE_IDS[shell];
  const files = await Promise.all(ids.map((id) => s.files.ref(id)));
  let managedBlock = false;
  let ohMyZsh = false;
  try {
    const snap = await s.files.read(configFileOf(shell));
    const block = findBlock(snap.content, MAIN_BLOCK);
    managedBlock = block.ok && block.value !== null;
    ohMyZsh = shell === 'zsh' && ohMyZshSourceLines(snap.content).length > 0;
  } catch {
    // Unreadable or out-of-HOME file: reported by the shell page itself.
  }
  const backups = await s.files.listBackups();
  const newest = backups
    .filter((b) => ids.includes(b.fileId))
    .map((b) => b.ts)
    .sort(compareBackupTimestamps)
    .pop();
  return {
    shell,
    installed: binary !== null,
    binary,
    isLoginShell: loginShell !== null && basename(loginShell) === shell,
    files,
    managedBlock,
    ohMyZsh,
    lastBackup: newest ?? null,
  };
}

/** `GET /api/inventory`: what is installed and which files exist. */
export function inventoryRoutes(app: Hono, s: Services): void {
  app.get(API_PATHS.inventory, async (c) => {
    const loginShell = s.loginShell();
    const [ghosttyVersion, ghosttyFiles, terminals, shells, pty] =
      await Promise.all([
        s.ghostty.version(),
        Promise.all(GHOSTTY_FILES.map((id) => s.files.ref(id))),
        Promise.all(TERMINAL_KINDS.map((k) => s.gsettings.info(k))),
        Promise.all(SHELL_NAMES.map((sh) => shellInfo(s, sh, loginShell))),
        s.pty.availability(),
      ]);
    return c.json<TerminalInventory>({
      home: s.dirs.home,
      loginShell,
      ghostty: {
        installed: ghosttyVersion !== null,
        version: ghosttyVersion,
        files: ghosttyFiles,
      },
      terminals,
      shells,
      pty,
    });
  });
}
