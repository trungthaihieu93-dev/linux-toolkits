import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import {
  FILE_IDS,
  formatBackupTimestamp,
  isBackupTimestamp,
  isFileId,
  type BackupContent,
  type BackupRef,
  type BackupTimestamp,
  type CheckResult,
  type ConfigFileRef,
  type FileId,
  type SaveResult,
} from '@linux-toolchain/term-config';
import {
  badRequest,
  checkFailed,
  conflict,
  errorMessage,
  HttpError,
  notFound,
  unprocessable,
} from '../errors';
import type { CommandRunner } from '../exec/command-runner';
import type { Dirs } from '../system/environment';
import { KeyedMutex } from '../system/keyed-mutex';

/** Files larger than this are not read (and could not be saved anyway). */
export const MAX_FILE_BYTES = 1024 * 1024;
/** Mode of a file td creates; existing files keep their mode. */
const NEW_FILE_MODE = 0o644;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export interface FileSnapshot {
  id: FileId;
  /** Allowlisted path (may be a symlink). */
  path: string;
  /** Path that is actually read and written (symlinks resolved). */
  realPath: string;
  exists: boolean;
  content: string;
  mtimeMs: number | null;
  /** Set when td will not write the file (not UTF-8); the reason. */
  readOnly?: string;
}

export interface WriteOptions {
  /** mtime the client read; null means the file must not exist yet. */
  baseMtimeMs: number | null;
}

/** One file of a `writeMany` call. */
export interface WriteItem extends WriteOptions {
  id: FileId;
  content: string;
}

type CheckKind = 'bash' | 'sh' | 'zsh' | 'ghostty';

/**
 * `.profile` is sourced by `/bin/sh` (dash on Debian/Ubuntu) at graphical
 * login, so it gets the POSIX check; bash-only syntax there breaks login.
 */
const CHECKS: Record<FileId, CheckKind> = {
  bashrc: 'bash',
  bash_profile: 'bash',
  bash_aliases: 'bash',
  profile: 'sh',
  zshrc: 'zsh',
  zshenv: 'zsh',
  zprofile: 'zsh',
  ghostty: 'ghostty',
  'ghostty-legacy': 'ghostty',
};

function checkArgv(kind: CheckKind, file: string): string[] {
  switch (kind) {
    case 'bash':
      return ['bash', '-n', file];
    case 'sh':
      return ['sh', '-n', file];
    case 'zsh':
      return ['zsh', '-n', file];
    case 'ghostty':
      return ['ghostty', '+validate-config', `--config-file=${file}`];
  }
}

const isErrno = (error: unknown, code: string) =>
  (error as NodeJS.ErrnoException | null)?.code === code;

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    throw error;
  }
}

async function realpathOr(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

// ignoreBOM keeps a leading byte order mark as U+FEFF in the text, so a
// save writes it back instead of silently dropping it.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The text of `bytes`, or null when they are not valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

const notUtf8 = (path: string) =>
  `${path} is not valid UTF-8; td shows it read-only and will not save it (edit it in a text editor)`;

/** Orders backup timestamps oldest first, `-N` suffixes numerically. */
export function compareBackupTimestamps(a: string, b: string): number {
  const [aBase, aN = '0'] = a.split('-');
  const [bBase, bN = '0'] = b.split('-');
  if (aBase !== bBase) return aBase < bBase ? -1 : 1;
  return Number(aN) - Number(bN);
}

/**
 * Reads and writes the allowlisted config files. Clients name files by id;
 * paths are resolved here against `HOME` and `XDG_CONFIG_HOME`.
 *
 * A write holds the file's in-process lock and is: optimistic concurrency
 * check on mtime (409) → refusal of a current file that is not UTF-8 (422)
 * → temp file in the target's folder with the target's mode → syntax check
 * on the temp file (422 on failure, temp removed, target untouched) → mtime
 * check again → backup of the current file (folder 0700, file 0600) → atomic
 * rename over the target. Symlinks are followed only when they stay inside
 * `HOME` (or `XDG_CONFIG_HOME` for Ghostty files); the real file is written,
 * so the link survives.
 */
export class FileStore {
  private readonly locks = new KeyedMutex();

  constructor(
    private readonly dirs: Dirs,
    private readonly runner: CommandRunner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get backupsDir(): string {
    return this.dirs.backups;
  }

  pathOf(id: FileId): string {
    const { home, configHome } = this.dirs;
    switch (id) {
      case 'bashrc':
        return join(home, '.bashrc');
      case 'bash_profile':
        return join(home, '.bash_profile');
      case 'bash_aliases':
        return join(home, '.bash_aliases');
      case 'profile':
        return join(home, '.profile');
      case 'zshrc':
        return join(home, '.zshrc');
      case 'zshenv':
        return join(home, '.zshenv');
      case 'zprofile':
        return join(home, '.zprofile');
      case 'ghostty':
        return join(configHome, 'ghostty', 'config.ghostty');
      case 'ghostty-legacy':
        return join(configHome, 'ghostty', 'config');
    }
  }

  async ref(id: FileId): Promise<ConfigFileRef> {
    const path = this.pathOf(id);
    return { id, path, exists: (await statOrNull(path))?.isFile() ?? false };
  }

  async read(id: FileId): Promise<FileSnapshot> {
    const { path, realPath } = await this.resolve(id);
    const st = await statOrNull(realPath);
    if (!st) {
      return { id, path, realPath, exists: false, content: '', mtimeMs: null };
    }
    if (!st.isFile()) throw badRequest(`${path} is not a regular file`);
    if (st.size > MAX_FILE_BYTES) {
      throw badRequest(`${path} is larger than ${MAX_FILE_BYTES} bytes`);
    }
    const bytes = await readFile(realPath);
    const text = decodeUtf8(bytes);
    const snap: FileSnapshot = {
      id,
      path,
      realPath,
      exists: true,
      content: text ?? new TextDecoder().decode(bytes),
      mtimeMs: st.mtimeMs,
    };
    if (text === null) snap.readOnly = notUtf8(path);
    return snap;
  }

  /**
   * Run the file's syntax check on `content` without touching the file or
   * creating folders: when the target's folder does not exist yet, the temp
   * file goes into a private folder under the system temp dir.
   */
  async check(id: FileId, content: string): Promise<CheckResult> {
    const { path, realPath } = await this.resolve(id);
    const st = await statOrNull(realPath);
    const parentExists = (await statOrNull(dirname(realPath)))?.isDirectory();
    const scratch = parentExists
      ? null
      : await mkdtemp(join(tmpdir(), 'td-check-'));
    const target = scratch ? join(scratch, basename(realPath)) : realPath;
    try {
      const tmp = await this.writeTemp(target, content, st);
      try {
        return await this.runCheck(id, tmp, path);
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  }

  write(id: FileId, content: string, opts: WriteOptions): Promise<SaveResult> {
    return this.writeMany([
      { id, content, baseMtimeMs: opts.baseMtimeMs },
    ]).then(([result]) => result);
  }

  /**
   * Write several files as one save, holding all their locks. Every file is
   * checked (mtime, UTF-8, syntax) before any is replaced. If replacing a
   * later file fails, the files already replaced are put back from their
   * backups (or removed when they did not exist), and the error says so.
   */
  async writeMany(items: readonly WriteItem[]): Promise<SaveResult[]> {
    const ids = items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      throw badRequest('a save names the same file twice');
    }
    for (const { content } of items) {
      if (content.includes('\0'))
        throw badRequest('content contains NUL bytes');
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) {
        throw badRequest(`content is larger than ${MAX_FILE_BYTES} bytes`);
      }
    }
    return this.locks.runAll(ids, () => this.writeLocked(items));
  }

  private async writeLocked(
    items: readonly WriteItem[],
  ): Promise<SaveResult[]> {
    /** `tmp` is '' once renamed; `check` is set once it passed. */
    const staged: {
      item: WriteItem;
      path: string;
      realPath: string;
      tmp: string;
      check: CheckResult | null;
    }[] = [];
    const replaced: { path: string; realPath: string; result: SaveResult }[] =
      [];
    try {
      for (const item of items) {
        const { path, realPath } = await this.resolve(item.id, true);
        const before = await statOrNull(realPath);
        if (before && !before.isFile()) {
          throw badRequest(`${path} is not a regular file`);
        }
        this.assertUnchanged(path, before, item.baseMtimeMs);
        if (before && decodeUtf8(await readFile(realPath)) === null) {
          throw unprocessable(notUtf8(path));
        }
        const tmp = await this.writeTemp(realPath, item.content, before);
        const entry = {
          item,
          path,
          realPath,
          tmp,
          check: null as CheckResult | null,
        };
        staged.push(entry);
        const check = await this.runCheck(item.id, tmp, path);
        if (!check.ok) {
          throw checkFailed(
            `${check.argv[0]} check failed for ${path}`,
            check.output,
          );
        }
        entry.check = check;
      }
      // The checks may take a while; re-check every file before replacing any.
      for (const { item, path, realPath } of staged) {
        this.assertUnchanged(
          path,
          await statOrNull(realPath),
          item.baseMtimeMs,
        );
      }
      for (const s of staged) {
        const current = await statOrNull(s.realPath);
        const backup = current
          ? await this.backup(s.item.id, s.realPath)
          : null;
        await rename(s.tmp, s.realPath);
        s.tmp = '';
        const after = await this.advanceMtime(s.realPath, current);
        replaced.push({
          path: s.path,
          realPath: s.realPath,
          result: {
            fileId: s.item.id,
            path: s.path,
            mtimeMs: after.mtimeMs,
            backup,
            check: s.check as CheckResult,
          },
        });
      }
      return replaced.map((r) => r.result);
    } catch (error) {
      if (replaced.length === 0) throw error;
      throw await this.rollBack(replaced, error);
    } finally {
      for (const { tmp } of staged) {
        if (tmp) await unlink(tmp).catch(() => undefined);
      }
    }
  }

  /**
   * mtime has coarse (jiffy) resolution, so a write right after a read can
   * keep the old value and defeat the mtime check. td's own writes always
   * move it forward, so a stale `baseMtimeMs` is always detected.
   */
  private async advanceMtime(
    realPath: string,
    previous: Stats | null,
  ): Promise<Stats> {
    const after = await stat(realPath);
    if (!previous || after.mtimeMs > previous.mtimeMs) return after;
    await utimes(
      realPath,
      after.atime,
      new Date(Math.floor(previous.mtimeMs) + 1),
    );
    return stat(realPath);
  }

  /** Put replaced files back after a later file of the same save failed. */
  private async rollBack(
    replaced: { path: string; realPath: string; result: SaveResult }[],
    cause: unknown,
  ): Promise<HttpError | Error> {
    const notes: string[] = [];
    for (const { path, realPath, result } of replaced.reverse()) {
      try {
        if (result.backup) {
          const bytes = await readFile(result.backup.path);
          const st = await statOrNull(realPath);
          const tmp = await this.writeTemp(realPath, bytes, st);
          try {
            await rename(tmp, realPath);
          } catch (error) {
            await unlink(tmp).catch(() => undefined);
            throw error;
          }
        } else {
          await unlink(realPath);
        }
        notes.push(`${path} was put back as it was`);
      } catch (error) {
        notes.push(
          `putting ${path} back failed (${errorMessage(error)}); its previous content is in ${result.backup?.path ?? 'no backup (it did not exist)'}`,
        );
      }
    }
    const message = `${errorMessage(cause)}; nothing else was saved: ${notes.join('; ')}`;
    return cause instanceof HttpError
      ? new HttpError(cause.status, message, cause.detail)
      : new Error(message);
  }

  /** Backups of `id` (every file when omitted), newest first. */
  async listBackups(id?: FileId): Promise<BackupRef[]> {
    const ids = id ? [id] : FILE_IDS;
    const out: BackupRef[] = [];
    for (const ts of await this.backupTimestamps()) {
      for (const fileId of ids) {
        const path = join(this.dirs.backups, ts, fileId);
        const st = await statOrNull(path);
        if (st?.isFile()) out.push({ fileId, ts, path, size: st.size });
      }
    }
    return out;
  }

  /** Backup folder names (valid timestamps only), newest first. */
  async backupTimestamps(): Promise<BackupTimestamp[]> {
    let names: string[];
    try {
      names = await readdir(this.dirs.backups);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return [];
      throw error;
    }
    return names
      .filter((n) => isBackupTimestamp(n))
      .sort((a, b) => compareBackupTimestamps(b, a));
  }

  async readBackup(id: FileId, ts: BackupTimestamp): Promise<BackupContent> {
    if (!isFileId(id) || !isBackupTimestamp(ts)) {
      throw badRequest('invalid backup id');
    }
    const path = join(this.dirs.backups, ts, id);
    const st = await statOrNull(path);
    if (!st?.isFile()) throw notFound(`no backup of ${id} at ${ts}`);
    if (st.size > MAX_FILE_BYTES) throw badRequest(`${path} is too large`);
    const bytes = await readFile(path);
    const text = decodeUtf8(bytes);
    const backup: BackupContent = {
      ref: { fileId: id, ts, path, size: st.size },
      content: text ?? new TextDecoder().decode(bytes),
    };
    if (text === null) {
      backup.readOnly = `${path} is not valid UTF-8; td will not restore it (copy the file back yourself)`;
    }
    return backup;
  }

  /**
   * Write a backup back. Goes through `write`, so the current content is
   * backed up first and the syntax check runs. Without `baseMtimeMs` the
   * current mtime is used (no concurrency check).
   */
  async restore(
    id: FileId,
    ts: BackupTimestamp,
    baseMtimeMs?: number | null,
  ): Promise<SaveResult> {
    const { content, readOnly } = await this.readBackup(id, ts);
    if (readOnly !== undefined) throw unprocessable(readOnly);
    const base =
      baseMtimeMs !== undefined ? baseMtimeMs : (await this.read(id)).mtimeMs;
    return this.write(id, content, { baseMtimeMs: base });
  }

  /**
   * Create a new private backup folder `<backups>/<ts>[-N]` and return its
   * timestamp and path. The backups root is forced to 0700.
   */
  async reserveBackupDir(): Promise<{ ts: BackupTimestamp; dir: string }> {
    await mkdir(this.dirs.backups, { recursive: true, mode: PRIVATE_DIR_MODE });
    await chmod(this.dirs.backups, PRIVATE_DIR_MODE);
    const date = this.now();
    for (let n = 0; n < 1000; n++) {
      const ts = formatBackupTimestamp(date, n || undefined);
      const dir = join(this.dirs.backups, ts);
      try {
        await mkdir(dir, { mode: PRIVATE_DIR_MODE });
        await chmod(dir, PRIVATE_DIR_MODE);
        return { ts, dir };
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error;
      }
    }
    throw new Error('could not create a backup folder');
  }

  /** Write `content` as a 0600 file inside a fresh backup folder. */
  async writePrivateBackup(
    name: string,
    content: string,
  ): Promise<{ ts: BackupTimestamp; path: string }> {
    const { ts, dir } = await this.reserveBackupDir();
    const path = join(dir, name);
    await writeFile(path, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    return { ts, path };
  }

  private async backup(id: FileId, realPath: string): Promise<BackupRef> {
    const content = await readFile(realPath);
    const { ts, dir } = await this.reserveBackupDir();
    const path = join(dir, id);
    await writeFile(path, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    return { fileId: id, ts, path, size: content.length };
  }

  private assertUnchanged(
    path: string,
    st: Stats | null,
    baseMtimeMs: number | null,
  ): void {
    const current = st ? st.mtimeMs : null;
    if (current !== baseMtimeMs) {
      throw conflict(
        `${path} changed on disk since it was read; reload and try again`,
      );
    }
  }

  private async writeTemp(
    realPath: string,
    content: string | Uint8Array,
    st: Stats | null,
  ): Promise<string> {
    const tmp = join(
      dirname(realPath),
      `.${basename(realPath)}.td-${randomBytes(6).toString('hex')}.tmp`,
    );
    const handle = await open(tmp, 'wx', PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(content);
      // Mode is set explicitly because the umask applies at creation.
      await handle.chmod(st ? st.mode & 0o7777 : NEW_FILE_MODE);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    await handle.close();
    return tmp;
  }

  private async runCheck(
    id: FileId,
    tmp: string,
    displayPath: string,
  ): Promise<CheckResult> {
    const argv = checkArgv(CHECKS[id], tmp);
    const result = await this.runner.run(argv, { timeoutMs: 20_000 });
    if (result.notFound) {
      return {
        ok: true,
        argv,
        output: '',
        skipped: `${argv[0]} is not installed`,
      };
    }
    const output = `${result.stdout}${result.stderr}`
      .split(tmp)
      .join(displayPath);
    return {
      ok: result.code === 0 && !result.error,
      argv,
      output: result.error ? `${output}${result.error}\n` : output,
    };
  }

  /**
   * Resolve an id to its allowlisted path and the real path to read/write.
   * Refuses symlinks (anywhere on the path) that lead outside the allowed
   * roots. With `createParent`, a missing parent folder is created.
   */
  private async resolve(
    id: FileId,
    createParent = false,
  ): Promise<{ path: string; realPath: string }> {
    if (!isFileId(id)) throw badRequest('unknown file id');
    const path = this.pathOf(id);
    const roots = [this.dirs.home];
    if (id === 'ghostty' || id === 'ghostty-legacy') {
      roots.push(this.dirs.configHome);
    }
    const realRoots = await Promise.all(roots.map(realpathOr));

    let realPath: string;
    try {
      realPath = await realpath(path);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        throw badRequest(`cannot resolve ${path}: ${errorMessage(error)}`);
      }
      const link = await lstat(path).catch(() => null);
      if (link?.isSymbolicLink()) {
        throw badRequest(`${path} is a symlink to a missing file`);
      }
      if (createParent) await mkdir(dirname(path), { recursive: true });
      const parent = await realpath(dirname(path)).catch(() => dirname(path));
      realPath = join(parent, basename(path));
    }
    const inside = realRoots.some((root) => realPath.startsWith(root + sep));
    if (!inside) {
      throw badRequest(
        `${path} resolves to ${realPath}, outside ${roots.join(' and ')}; td does not edit it`,
      );
    }
    return { path, realPath };
  }
}
