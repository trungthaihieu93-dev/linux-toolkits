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
import { chmodSync, utimesSync, writeFileSync } from 'node:fs';
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
const hasDash = await haveBinaries('sh', 'bash');

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

describe('FileStore safety', () => {
  const latin1 = Buffer.concat([
    Buffer.from('# caf'),
    Buffer.from([0xe9]),
    Buffer.from('\necho ok\n'),
  ]);

  it('shows a file that is not UTF-8 read-only and refuses to write it', async () => {
    await writeFile(bashrc(), latin1);
    const snap = await store.read('bashrc');
    expect(snap.readOnly).toMatch(/not valid UTF-8/);
    const error = await expectStatus(
      store.write('bashrc', 'echo new\n', { baseMtimeMs: snap.mtimeMs }),
      422,
    );
    expect(error.message).toMatch(/not valid UTF-8/);
    expect(await readFile(bashrc())).toEqual(latin1);
    expect(await store.listBackups('bashrc')).toEqual([]);
  });

  it('reads valid UTF-8 as writable', async () => {
    await writeFile(bashrc(), '# café\n');
    const snap = await store.read('bashrc');
    expect(snap.readOnly).toBeUndefined();
    expect(snap.content).toBe('# café\n');
  });

  it.skipIf(!hasBash)(
    'marks a backup that is not UTF-8 read-only and refuses to restore it',
    async () => {
      await writeFile(bashrc(), latin1);
      const ts = '20261108T040000Z';
      await mkdir(join(store.backupsDir, ts), { recursive: true });
      await writeFile(join(store.backupsDir, ts, 'bashrc'), latin1);
      await writeFile(bashrc(), 'echo now\n');
      expect((await store.readBackup('bashrc', ts)).readOnly).toMatch(
        /not valid UTF-8/,
      );
      await expectStatus(store.restore('bashrc', ts), 422);
      expect(await readFile(bashrc(), 'utf8')).toBe('echo now\n');
    },
  );

  it.skipIf(!hasBash)(
    'serialises concurrent writes to one file so only one passes the mtime check',
    async () => {
      await writeFile(bashrc(), 'echo base\n');
      const snap = await store.read('bashrc');
      const results = await Promise.allSettled([
        store.write('bashrc', 'echo a\n', { baseMtimeMs: snap.mtimeMs }),
        store.write('bashrc', 'echo b\n', { baseMtimeMs: snap.mtimeMs }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0].reason as HttpError).status).toBe(409);
      expect(await readFile(bashrc(), 'utf8')).toBe('echo a\n');
      expect(await store.listBackups('bashrc')).toHaveLength(1);
    },
  );

  it('keeps a leading UTF-8 BOM through a read and a save', async () => {
    const s = new FileStore(
      resolveDirs(sbx.env, sbx.home),
      new RecordingCommandRunner(() => ({ code: 0 })),
    );
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# with BOM\n'),
    ]);
    await writeFile(bashrc(), original);
    const snap = await s.read('bashrc');
    expect(snap.readOnly).toBeUndefined();
    expect(snap.content).toBe('\uFEFF# with BOM\n');

    const saved = await s.write('bashrc', snap.content, {
      baseMtimeMs: snap.mtimeMs,
    });
    expect(await readFile(bashrc())).toEqual(original);
    const backup = await s.readBackup('bashrc', saved.backup?.ts as string);
    expect(backup.content).toBe('\uFEFF# with BOM\n');
  });

  it.skipIf(!hasDash)(
    'checks .profile with sh -n and bash files with bash -n',
    async () => {
      const bashOnly = 'a=(1 2)\necho "${a[0]}"\n';
      const profile = await store.check('profile', bashOnly);
      expect(profile.argv[0]).toBe('sh');
      expect(profile.ok).toBe(false);
      await expectStatus(
        store.write('profile', bashOnly, { baseMtimeMs: null }),
        422,
      );
      const rc = await store.check('bashrc', bashOnly);
      expect(rc.argv[0]).toBe('bash');
      expect(rc.ok).toBe(true);
    },
  );

  it('does not create missing folders for a check or a preview', async () => {
    const runner = new RecordingCommandRunner(() => ({ code: 0 }));
    const s = new FileStore(resolveDirs(sbx.env, sbx.home), runner);
    const dir = join(sbx.env['XDG_CONFIG_HOME'], 'ghostty');
    const preview = await previewWrite(s, 'ghostty', 'font-size = 12\n');
    expect(preview.check.ok).toBe(true);
    expect(runner.calls).toHaveLength(1);
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  describe('writeMany', () => {
    const ghosttyDir = () => join(sbx.env['XDG_CONFIG_HOME'], 'ghostty');
    const main = () => join(ghosttyDir(), 'config.ghostty');
    const legacy = () => join(ghosttyDir(), 'config');
    const isLegacyCheck = (argv: readonly string[]) =>
      argv[0] === 'ghostty' && /\/\.config\.td-[0-9a-f]+\.tmp$/.test(argv[2]);

    async function twoFiles(onCheck: (argv: readonly string[]) => void) {
      await mkdir(ghosttyDir(), { recursive: true });
      await writeFile(main(), 'font-size = 10\n');
      await writeFile(legacy(), 'theme = old\n');
      const runner = new RecordingCommandRunner((argv) => {
        onCheck(argv);
        return { code: 0 };
      });
      const s = new FileStore(
        resolveDirs(sbx.env, sbx.home),
        runner,
        () => clock,
      );
      const a = await s.read('ghostty');
      const b = await s.read('ghostty-legacy');
      return { s, a, b };
    }

    it('writes nothing when a file changes on disk during the checks', async () => {
      const { s, a, b } = await twoFiles((argv) => {
        if (isLegacyCheck(argv)) {
          writeFileSync(legacy(), 'theme = other\n');
          utimesSync(legacy(), new Date(), new Date(Date.now() + 5000));
        }
      });
      await expectStatus(
        s.writeMany([
          {
            id: 'ghostty',
            content: 'font-size = 12\n',
            baseMtimeMs: a.mtimeMs,
          },
          {
            id: 'ghostty-legacy',
            content: 'theme = new\n',
            baseMtimeMs: b.mtimeMs,
          },
        ]),
        409,
      );
      expect(await readFile(main(), 'utf8')).toBe('font-size = 10\n');
      expect(await s.listBackups()).toEqual([]);
    });

    it('puts the first file back when writing the second fails', async () => {
      const { s, a, b } = await twoFiles((argv) => {
        // The second file becomes unreadable, so its backup fails.
        if (isLegacyCheck(argv)) chmodSync(legacy(), 0o000);
      });
      const error = await s
        .writeMany([
          {
            id: 'ghostty',
            content: 'font-size = 12\n',
            baseMtimeMs: a.mtimeMs,
          },
          {
            id: 'ghostty-legacy',
            content: 'theme = new\n',
            baseMtimeMs: b.mtimeMs,
          },
        ])
        .then(
          () => null,
          (e: unknown) => e as Error,
        );
      await chmod(legacy(), 0o644);
      expect(error?.message).toMatch(/config\.ghostty was put back/);
      expect(await readFile(main(), 'utf8')).toBe('font-size = 10\n');
      expect(await readFile(legacy(), 'utf8')).toBe('theme = old\n');
      expect(await tmpLeftovers(ghosttyDir())).toEqual([]);
    });
  });
});
