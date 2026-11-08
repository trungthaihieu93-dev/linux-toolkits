import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { FileId } from '@linux-toolchain/term-config';
import { HttpError } from '../errors';
import { createActivityBus } from '../exec/activity-bus';
import {
  ProcessCommandRunner,
  RecordingCommandRunner,
} from '../exec/command-runner';
import { resolveDirs } from '../system/environment';
import { createSandbox, haveBinaries, type Sandbox } from '../testing/sandbox';
import { compareBackupTimestamps, FileStore } from './file-store';
import { previewWrite } from './preview';

const hasBash = await haveBinaries('bash');

let sbx: Sandbox;
let store: FileStore;
let clock: Date;

beforeEach(async () => {
  sbx = await createSandbox('td-files-');
  clock = new Date(Date.UTC(2026, 10, 8, 5, 0, 0));
  const runner = new ProcessCommandRunner(createActivityBus(), sbx.env);
  store = new FileStore(resolveDirs(sbx.env, sbx.home), runner, () => clock);
});
afterEach(() => sbx.cleanup());

const bashrc = () => join(sbx.home, '.bashrc');

async function expectStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(status);
  return error as HttpError;
}

const tmpLeftovers = async (dir: string) =>
  (await readdir(dir)).filter((n) => n.endsWith('.tmp'));

describe('FileStore', () => {
  it('rejects ids outside the allowlist', async () => {
    await expectStatus(store.read('../etc/passwd' as FileId), 400);
    await expectStatus(
      store.write('bashrc ' as FileId, 'x', { baseMtimeMs: null }),
      400,
    );
  });

  it('resolves ids against HOME and XDG_CONFIG_HOME', () => {
    expect(store.pathOf('zshrc')).toBe(join(sbx.home, '.zshrc'));
    expect(store.pathOf('ghostty')).toBe(
      join(sbx.env['XDG_CONFIG_HOME'], 'ghostty', 'config.ghostty'),
    );
    expect(store.pathOf('ghostty-legacy')).toBe(
      join(sbx.env['XDG_CONFIG_HOME'], 'ghostty', 'config'),
    );
  });

  it('reads a missing file as empty with a null mtime', async () => {
    expect(await store.read('bashrc')).toMatchObject({
      exists: false,
      content: '',
      mtimeMs: null,
    });
  });

  it.skipIf(!hasBash)(
    'creates a new file when baseMtimeMs is null',
    async () => {
      const result = await store.write('bashrc', 'alias ll="ls -l"\n', {
        baseMtimeMs: null,
      });
      expect(result.backup).toBeNull();
      expect(result.check).toMatchObject({
        ok: true,
        argv: ['bash', '-n', expect.any(String)],
      });
      expect(await readFile(bashrc(), 'utf8')).toBe('alias ll="ls -l"\n');
    },
  );

  it('refuses symlinks that lead outside HOME, for reads and writes', async () => {
    const outside = join(sbx.root, 'outside-rc');
    await writeFile(outside, 'echo outside\n');
    await symlink(outside, bashrc());
    await expectStatus(store.read('bashrc'), 400);
    await expectStatus(
      store.write('bashrc', 'echo hacked\n', { baseMtimeMs: null }),
      400,
    );
    expect(await readFile(outside, 'utf8')).toBe('echo outside\n');
  });

  it('refuses a folder symlink on the path that leads outside the roots', async () => {
    const outside = join(sbx.root, 'outside-ghostty');
    await mkdir(outside);
    await symlink(outside, join(sbx.env['XDG_CONFIG_HOME'], 'ghostty'));
    await expectStatus(
      store.write('ghostty', 'font-size = 12\n', { baseMtimeMs: null }),
      400,
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it.skipIf(!hasBash)(
    'writes the real file behind a symlink inside HOME',
    async () => {
      const real = join(sbx.home, 'dotfiles', 'bashrc');
      await mkdir(join(sbx.home, 'dotfiles'));
      await writeFile(real, 'echo one\n');
      await symlink(real, bashrc());
      const snap = await store.read('bashrc');
      expect(snap.realPath).toBe(real);
      await store.write('bashrc', 'echo two\n', { baseMtimeMs: snap.mtimeMs });
      expect(await readFile(real, 'utf8')).toBe('echo two\n');
      expect((await lstat(bashrc())).isSymbolicLink()).toBe(true);
    },
  );

  it('returns 409 when the file changed since it was read', async () => {
    await writeFile(bashrc(), 'echo one\n');
    const snap = await store.read('bashrc');
    await utimes(bashrc(), new Date(), new Date(Date.now() + 5000));
    await expectStatus(
      store.write('bashrc', 'echo two\n', { baseMtimeMs: snap.mtimeMs }),
      409,
    );
    await expectStatus(
      store.write('bashrc', 'echo two\n', { baseMtimeMs: null }),
      409,
    );
    expect(await readFile(bashrc(), 'utf8')).toBe('echo one\n');
  });

  it.skipIf(!hasBash)(
    'leaves the original untouched and removes the temp file when the check fails',
    async () => {
      await writeFile(bashrc(), 'echo ok\n');
      const snap = await store.read('bashrc');
      const error = await expectStatus(
        store.write('bashrc', 'if then fi (\n', { baseMtimeMs: snap.mtimeMs }),
        422,
      );
      expect(error.detail).toContain(bashrc());
      expect(error.detail).not.toContain('.td-');
      expect(await readFile(bashrc(), 'utf8')).toBe('echo ok\n');
      expect(await tmpLeftovers(sbx.home)).toEqual([]);
      expect(await store.listBackups('bashrc')).toEqual([]);
    },
  );

  it.skipIf(!hasBash)('preserves the file mode', async () => {
    await writeFile(bashrc(), 'echo one\n');
    await chmod(bashrc(), 0o640);
    const snap = await store.read('bashrc');
    await store.write('bashrc', 'echo two\n', { baseMtimeMs: snap.mtimeMs });
    expect((await stat(bashrc())).mode & 0o777).toBe(0o640);
  });

  it.skipIf(!hasBash)(
    'backs up privately, then restores round-trip (taking a backup first)',
    async () => {
      await writeFile(bashrc(), 'export TOKEN=secret\n');
      const first = await store.read('bashrc');
      const saved = await store.write('bashrc', 'echo new\n', {
        baseMtimeMs: first.mtimeMs,
      });
      expect(saved.backup).toMatchObject({
        fileId: 'bashrc',
        ts: '20261108T050000Z',
      });
      const backup = saved.backup as NonNullable<typeof saved.backup>;
      expect((await stat(backup.path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(store.backupsDir, backup.ts))).mode & 0o777).toBe(
        0o700,
      );
      expect((await stat(store.backupsDir)).mode & 0o777).toBe(0o700);
      expect(await readFile(backup.path, 'utf8')).toBe('export TOKEN=secret\n');

      const restored = await store.restore('bashrc', backup.ts);
      expect(await readFile(bashrc(), 'utf8')).toBe('export TOKEN=secret\n');
      // Same second: the restore's own backup gets a -1 suffix.
      expect(restored.backup?.ts).toBe('20261108T050000Z-1');
      expect(await readFile(restored.backup?.path as string, 'utf8')).toBe(
        'echo new\n',
      );
      const list = await store.listBackups('bashrc');
      expect(list.map((b) => b.ts)).toEqual([
        '20261108T050000Z-1',
        '20261108T050000Z',
      ]);
    },
  );

  it('reports a skipped check when the checker is not installed', async () => {
    const runner = new RecordingCommandRunner(() => ({
      code: null,
      notFound: true,
    }));
    const s = new FileStore(resolveDirs(sbx.env, sbx.home), runner);
    const result = await s.write('ghostty', 'font-size = 12\n', {
      baseMtimeMs: null,
    });
    expect(result.check).toMatchObject({
      ok: true,
      skipped: 'ghostty is not installed',
    });
    expect(runner.calls[0].argv[0]).toBe('ghostty');
    expect(runner.calls[0].argv[2]).toMatch(
      /^--config-file=.*\.td-[0-9a-f]+\.tmp$/,
    );
  });

  it('rejects a missing backup and invalid timestamps', async () => {
    await expectStatus(store.readBackup('bashrc', '20261108T050000Z'), 404);
    await expectStatus(store.readBackup('bashrc', '../../x'), 400);
  });

  it('orders backup timestamps with numeric suffixes', () => {
    const list = [
      '20261108T050000Z-10',
      '20261108T050000Z',
      '20261108T050000Z-2',
    ];
    expect(list.sort(compareBackupTimestamps)).toEqual([
      '20261108T050000Z',
      '20261108T050000Z-2',
      '20261108T050000Z-10',
    ]);
  });
});

describe('previewWrite', () => {
  it.skipIf(!hasBash)(
    'returns a diff and the check result without writing',
    async () => {
      await writeFile(bashrc(), 'echo one\n');
      const preview = await previewWrite(store, 'bashrc', 'echo two\n');
      expect(preview.changed).toBe(true);
      expect(preview.diff).toContain('-echo one');
      expect(preview.diff).toContain('+echo two');
      expect(preview.check.ok).toBe(true);
      expect(preview.baseMtimeMs).toBe((await stat(bashrc())).mtimeMs);
      expect(await readFile(bashrc(), 'utf8')).toBe('echo one\n');
      expect(await tmpLeftovers(sbx.home)).toEqual([]);
    },
  );

  it.skipIf(!hasBash)(
    'reports a failing check and an empty diff when unchanged',
    async () => {
      await writeFile(bashrc(), 'echo one\n');
      expect((await previewWrite(store, 'bashrc', 'echo one\n')).diff).toBe('');
      const bad = await previewWrite(store, 'bashrc', 'fi\n');
      expect(bad.check.ok).toBe(false);
      expect(bad.check.output).toContain('syntax error');
    },
  );
});
