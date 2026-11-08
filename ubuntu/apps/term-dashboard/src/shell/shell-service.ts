import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  analyzeShellFile,
  applyShellModel,
  CONFIG_MODE_FILE_IDS,
  SHELL_FILE_IDS,
  type FileId,
  type OhMyZshCatalog,
  type SavePreview,
  type SaveResult,
  type ShellBlockModel,
  type ShellFileView,
  type ShellName,
} from '@linux-toolchain/term-config';
import { badRequest } from '../errors';
import type { FileStore } from '../files/file-store';
import { previewWrite } from '../files/preview';
import type { Env } from '../system/environment';

/** Config-mode file of each shell (the first allowlisted file). */
export const configFileOf = (shell: ShellName): FileId =>
  SHELL_FILE_IDS[shell][0];

export class ShellService {
  constructor(
    private readonly files: FileStore,
    private readonly env: Env,
    private readonly home: string,
  ) {}

  private assertShellFile(shell: ShellName, fileId: FileId): void {
    if (!SHELL_FILE_IDS[shell].includes(fileId)) {
      throw badRequest(`${fileId} is not a ${shell} file`);
    }
  }

  private assertConfigFile(shell: ShellName, fileId: FileId): void {
    this.assertShellFile(shell, fileId);
    if (!CONFIG_MODE_FILE_IDS.includes(fileId)) {
      throw badRequest(`Config mode edits only ${configFileOf(shell)}`);
    }
  }

  async fileView(shell: ShellName, fileId: FileId): Promise<ShellFileView> {
    this.assertShellFile(shell, fileId);
    const snap = await this.files.read(fileId);
    const analysis = analyzeShellFile(snap.content, shell);
    const view: ShellFileView = {
      shell,
      fileId,
      path: snap.path,
      exists: snap.exists,
      content: snap.content,
      mtimeMs: snap.mtimeMs,
      configMode: CONFIG_MODE_FILE_IDS.includes(fileId),
      blocks: analysis.blocks,
      model: analysis.model,
      outside: analysis.outside,
      ohMyZsh: analysis.ohMyZsh,
    };
    if (analysis.modelError !== undefined) {
      view.modelError = analysis.modelError;
    }
    if (snap.readOnly !== undefined) view.readOnly = snap.readOnly;
    return view;
  }

  /** The file content with `model` written into its managed blocks. */
  private render(shell: ShellName, content: string, model: ShellBlockModel) {
    const result = applyShellModel(content, model, shell);
    if (!result.ok) throw badRequest('invalid shell config', result.error);
    return result.value;
  }

  async previewConfig(
    shell: ShellName,
    fileId: FileId,
    model: ShellBlockModel,
  ): Promise<SavePreview> {
    this.assertConfigFile(shell, fileId);
    const snap = await this.files.read(fileId);
    const candidate = this.render(shell, snap.content, model);
    return previewWrite(this.files, fileId, candidate, snap);
  }

  /**
   * Re-render the blocks over the file as it is now and write it. The mtime
   * check in FileStore rejects the save when the file changed since
   * `baseMtimeMs`, so the rendered text matches what the user previewed.
   */
  async saveConfig(
    shell: ShellName,
    fileId: FileId,
    model: ShellBlockModel,
    baseMtimeMs: number | null,
  ): Promise<SaveResult> {
    this.assertConfigFile(shell, fileId);
    const snap = await this.files.read(fileId);
    const candidate = this.render(shell, snap.content, model);
    return this.files.write(fileId, candidate, { baseMtimeMs });
  }

  async previewRaw(
    shell: ShellName,
    fileId: FileId,
    content: string,
  ): Promise<SavePreview> {
    this.assertShellFile(shell, fileId);
    return previewWrite(this.files, fileId, content);
  }

  async saveRaw(
    shell: ShellName,
    fileId: FileId,
    content: string,
    baseMtimeMs: number | null,
  ): Promise<SaveResult> {
    this.assertShellFile(shell, fileId);
    return this.files.write(fileId, content, { baseMtimeMs });
  }

  /** Themes and plugins of the oh-my-zsh install (`$ZSH` or `~/.oh-my-zsh`). */
  async ohMyZshCatalog(shell: ShellName): Promise<OhMyZshCatalog> {
    if (shell !== 'zsh') throw badRequest('oh-my-zsh is for zsh only');
    const candidates = [this.env['ZSH'], join(this.home, '.oh-my-zsh')].filter(
      (p): p is string => typeof p === 'string' && isAbsolute(p),
    );
    let root: string | null = null;
    for (const dir of candidates) {
      if (await isFile(join(dir, 'oh-my-zsh.sh'))) {
        root = dir;
        break;
      }
    }
    if (root === null) return { root: null, themes: [], plugins: [] };
    const custom =
      this.env['ZSH_CUSTOM'] && isAbsolute(this.env['ZSH_CUSTOM'])
        ? this.env['ZSH_CUSTOM']
        : join(root, 'custom');
    const themes = new Set<string>();
    const plugins = new Set<string>();
    for (const dir of [join(root, 'themes'), join(custom, 'themes')]) {
      for (const name of (await list(dir, 'file')) ?? []) {
        if (name.endsWith('.zsh-theme')) themes.add(name.slice(0, -10));
      }
    }
    for (const dir of [join(root, 'plugins'), join(custom, 'plugins')]) {
      for (const name of (await list(dir, 'dir')) ?? []) {
        if (name !== 'example' && !name.startsWith('.')) plugins.add(name);
      }
    }
    const sorted = (s: Set<string>) =>
      [...s].sort((a, b) => a.localeCompare(b));
    return { root, themes: sorted(themes), plugins: sorted(plugins) };
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Names of the files or folders in `dir` (symlinks count as both); null when unreadable. */
async function list(
  dir: string,
  kind: 'file' | 'dir',
): Promise<string[] | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) =>
        kind === 'dir'
          ? e.isDirectory() || e.isSymbolicLink()
          : e.isFile() || e.isSymbolicLink(),
      )
      .map((e) => e.name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request shape checks (content rules live in term-config's validateShellModel)

const MAX_ITEMS = 2000;
const MAX_TEXT = 8192;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_TEXT;
const textList = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.length > MAX_ITEMS || !v.every(isText)) {
    throw badRequest(`${what} must be a list of strings`);
  }
  return v;
};
const pairs = <K extends string>(
  v: unknown,
  what: string,
  second: K,
): ({ name: string } & Record<K, string>)[] => {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) {
    throw badRequest(`${what} must be a list`);
  }
  return v.map((item) => {
    if (!isObj(item) || !isText(item['name']) || !isText(item[second])) {
      throw badRequest(`every entry of ${what} needs name and ${second}`);
    }
    return { name: item['name'], [second]: item[second] } as {
      name: string;
    } & Record<K, string>;
  });
};
const optionalNumber = (v: unknown, what: string): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw badRequest(`${what} must be a non-negative integer`);
  }
  return v;
};
const optionalBool = (v: unknown, what: string): boolean | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw badRequest(`${what} must be true or false`);
  return v;
};

/** Shape-check a `ShellBlockModel` from a request body. */
export function parseShellBlockModel(value: unknown): ShellBlockModel {
  if (!isObj(value)) throw badRequest('model must be an object');
  const path = value['path'];
  if (!isObj(path)) throw badRequest('model.path must be an object');
  const history = value['history'] ?? {};
  if (!isObj(history)) throw badRequest('model.history must be an object');
  const model: ShellBlockModel = {
    aliases: pairs(value['aliases'], 'aliases', 'command'),
    exports: pairs(value['exports'], 'exports', 'value'),
    path: {
      prepend: textList(path['prepend'], 'path.prepend'),
      append: textList(path['append'], 'path.append'),
    },
    history: {},
  };
  const size = optionalNumber(history['size'], 'history.size');
  const fileSize = optionalNumber(history['fileSize'], 'history.fileSize');
  const ignoreDups = optionalBool(history['ignoreDups'], 'history.ignoreDups');
  const share = optionalBool(history['share'], 'history.share');
  if (size !== undefined) model.history.size = size;
  if (fileSize !== undefined) model.history.fileSize = fileSize;
  if (ignoreDups !== undefined) model.history.ignoreDups = ignoreDups;
  if (share !== undefined) model.history.share = share;
  if (value['extra'] !== undefined) {
    model.extra = textList(value['extra'], 'extra');
  }
  // Absent: leave the oh-my-zsh block as it is. null: remove it.
  const omz = value['ohMyZsh'];
  if (omz === null) model.ohMyZsh = {};
  if (omz !== undefined && omz !== null) {
    if (!isObj(omz)) throw badRequest('ohMyZsh must be an object');
    model.ohMyZsh = {};
    if (omz['theme'] !== undefined) {
      if (!isText(omz['theme']))
        throw badRequest('ohMyZsh.theme must be a string');
      model.ohMyZsh.theme = omz['theme'];
    }
    if (omz['plugins'] !== undefined) {
      model.ohMyZsh.plugins = textList(omz['plugins'], 'ohMyZsh.plugins');
    }
    if (omz['extra'] !== undefined) {
      model.ohMyZsh.extra = textList(omz['extra'], 'ohMyZsh.extra');
    }
  }
  return model;
}
