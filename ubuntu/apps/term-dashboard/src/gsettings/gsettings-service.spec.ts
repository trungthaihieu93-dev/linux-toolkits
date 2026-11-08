import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseGSchema, type GSchema } from '@linux-toolchain/term-config';
import { HttpError } from '../errors';
import {
  RecordingCommandRunner,
  type CommandResult,
  type RunOptions,
} from '../exec/command-runner';
import { FileStore } from '../files/file-store';
import { resolveDirs } from '../system/environment';
import { createSandbox, type Sandbox } from '../testing/sandbox';
import { GSettingsService } from './gsettings-service';

const FIXTURE = join(
  import.meta.dirname,
  '../../../../libs/term-config/src/__fixtures__/org.gnome.Ptyxis.gschema.xml',
);
const DEFAULT_UUID = '91d0e1138a06858802ff88506ae490ea';
const OTHER_UUID = '0123456789abcdef0123456789abcdef';

/**
 * In-memory stand-in for the gsettings CLI over the fixture schema: enough
 * of list-recursively/get/set/reset/reset-recursively for the service.
 */
class FakeGSettings {
  readonly store = new Map<string, Map<string, string>>();
  constructor(private readonly schemas: GSchema[]) {}

  private locate(arg: string): { schema: GSchema; path: string } {
    const [id, path] = arg.split(/:(.*)/s);
    const schema = this.schemas.find((s) => s.schemaId === id);
    if (!schema) throw new Error(`No such schema “${id}”`);
    const p = schema.path ?? path;
    if (!p)
      throw new Error('Schema is relocatable, and a path must be specified');
    return { schema, path: p };
  }

  values(path: string): Map<string, string> {
    let m = this.store.get(path);
    if (!m) this.store.set(path, (m = new Map()));
    return m;
  }

  respond = (
    argv: readonly string[],
    opts: RunOptions,
  ): Partial<CommandResult> | undefined => {
    if (argv[0] !== 'gsettings') return { code: 1, notFound: true };
    const [, cmd, arg, key, value] = argv;
    try {
      const { schema, path } = this.locate(arg);
      const memory = opts.env?.['GSETTINGS_BACKEND'] === 'memory';
      const vals = memory ? new Map<string, string>() : this.values(path);
      const keyOk = (k: string) => schema.keys.some((x) => x.name === k);
      switch (cmd) {
        case 'list-recursively':
          return {
            stdout: schema.keys
              .map(
                (k) =>
                  `${schema.schemaId} ${k.name} ${vals.get(k.name) ?? k.default}\n`,
              )
              .join(''),
          };
        case 'get':
          if (!keyOk(key)) throw new Error('No such key');
          return {
            stdout: `${vals.get(key) ?? schema.keys.find((k) => k.name === key)?.default}\n`,
          };
        case 'set':
          if (!keyOk(key)) throw new Error('No such key');
          vals.set(key, value);
          return {};
        case 'reset':
          vals.delete(key);
          return {};
        case 'reset-recursively':
          vals.clear();
          return {};
      }
      throw new Error(`unknown command ${cmd}`);
    } catch (error) {
      return { code: 1, stderr: `${(error as Error).message}\n` };
    }
  };
}

let sbx: Sandbox;
let runner: RecordingCommandRunner;
let fake: FakeGSettings;
let service: GSettingsService;
let files: FileStore;

beforeEach(async () => {
  sbx = await createSandbox('td-gs-');
  const dataDir = join(sbx.root, 'share');
  await mkdir(join(dataDir, 'glib-2.0', 'schemas'), { recursive: true });
  await copyFile(
    FIXTURE,
    join(dataDir, 'glib-2.0', 'schemas', 'org.gnome.Ptyxis.gschema.xml'),
  );
  const env = { ...sbx.env, XDG_DATA_DIRS: dataDir, PATH: '/nonexistent' };
  fake = new FakeGSettings(parseGSchema(await readFile(FIXTURE, 'utf8')));
  fake
    .values('/org/gnome/Ptyxis/')
    .set('profile-uuids', `['${DEFAULT_UUID}', '${OTHER_UUID}']`);
  fake
    .values('/org/gnome/Ptyxis/')
    .set('default-profile-uuid', `'${DEFAULT_UUID}'`);
  fake
    .values(`/org/gnome/Ptyxis/Profiles/${DEFAULT_UUID}/`)
    .set('label', "'Main'");
  fake
    .values(`/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`)
    .set('label', "'Other'");
  fake
    .values(`/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`)
    .set('opacity', '0.5');
  runner = new RecordingCommandRunner(fake.respond);
  const dirs = resolveDirs(env, sbx.home);
  files = new FileStore(dirs, runner);
  service = new GSettingsService(runner, files, dirs, env);
});
afterEach(async () => {
  // gsettings only: the dconf CLI would bypass a sandboxed backend.
  expect(
    runner.calls.some((c) => c.argv.some((a) => /(^|\/)dconf$/.test(a))),
  ).toBe(false);
  await sbx.cleanup();
});

const status = (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e: unknown) => (e instanceof HttpError ? e.status : -1),
  );
const gsCalls = () => runner.calls.filter((c) => c.argv[0] === 'gsettings');

describe('GSettingsService', () => {
  it('reports schemas from the XML and no GNOME Terminal schema', async () => {
    const ptyxis = await service.info('ptyxis');
    expect(ptyxis.installed).toBe(false);
    expect(ptyxis.schemas?.shortcuts).toEqual({
      schema: 'org.gnome.Ptyxis.Shortcuts',
      path: '/org/gnome/Ptyxis/Shortcuts/',
    });
    expect((await service.info('gnome-terminal')).schemas).toBeNull();
    expect(
      await status(service.view('gnome-terminal', { part: 'global' })),
    ).toBe(503);
  });

  it('builds a view from one listing plus cached memory-backend defaults', async () => {
    const view = await service.view('ptyxis', { part: 'global' });
    expect(view.keys).toHaveLength(27);
    expect(
      view.keys.find((k) => k.name === 'default-profile-uuid')?.isDefault,
    ).toBe(false);
    const calls = gsCalls().map((c) => [
      c.argv.slice(1).join(' '),
      c.opts.env?.['GSETTINGS_BACKEND'] ?? '',
    ]);
    expect(calls).toEqual([
      ['list-recursively org.gnome.Ptyxis', ''],
      ['list-recursively org.gnome.Ptyxis', 'memory'],
    ]);
    await service.view('ptyxis', { part: 'global' });
    expect(gsCalls()).toHaveLength(3);
  });

  it('addresses a profile by SCHEMA:PATH and 404s unknown profiles', async () => {
    const view = await service.view('ptyxis', {
      part: 'profile',
      uuid: OTHER_UUID,
    });
    expect(view.path).toBe(`/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`);
    expect(view.keys.find((k) => k.name === 'opacity')).toMatchObject({
      value: '0.5',
      isDefault: false,
    });
    expect(runner.commands()).toContain(
      `gsettings list-recursively org.gnome.Ptyxis.Profile:/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`,
    );
    expect(
      await status(
        service.view('ptyxis', { part: 'profile', uuid: 'f'.repeat(32) }),
      ),
    ).toBe(404);
    expect(
      await status(service.view('ptyxis', { part: 'profile', uuid: '../x' })),
    ).toBe(400);
  });

  it('validates keys and values before calling gsettings set', async () => {
    const g = { part: 'global' } as const;
    expect(await status(service.set('ptyxis', g, 'no-such-key', 'true'))).toBe(
      400,
    );
    expect(await status(service.set('ptyxis', g, 'audible-bell', 'yes'))).toBe(
      400,
    );
    expect(
      await status(service.set('ptyxis', g, 'cursor-shape', "'triangle'")),
    ).toBe(400);
    const p = { part: 'profile', uuid: OTHER_UUID } as const;
    expect(await status(service.set('ptyxis', p, 'opacity', '1.5'))).toBe(400);
    expect(runner.commands().some((c) => c.startsWith('gsettings set'))).toBe(
      false,
    );
  });

  it('takes one private JSON backup before the first write of the run', async () => {
    await service.set('ptyxis', { part: 'global' }, 'audible-bell', 'false');
    await service.set('ptyxis', { part: 'global' }, 'cursor-shape', "'ibeam'");
    const backups = await service.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].kinds).toEqual(['ptyxis']);
    expect((await stat(backups[0].path)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(backups[0].path, 'utf8'));
    expect(saved.terminals[0].profileUuids).toEqual([DEFAULT_UUID, OTHER_UUID]);
    const firstSet = runner
      .commands()
      .findIndex((c) => c.startsWith('gsettings set'));
    const backupReads = runner.commands().slice(0, firstSet);
    expect(backupReads).toContain(
      `gsettings list-recursively org.gnome.Ptyxis.Profile:/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`,
    );
    expect(fake.store.get('/org/gnome/Ptyxis/')?.get('cursor-shape')).toBe(
      "'ibeam'",
    );
  });

  it('creates, duplicates and deletes profiles; never deletes the default', async () => {
    const created = await service.createProfile('ptyxis', 'Work');
    expect(created).toMatch(/^[0-9a-f]{32}$/);
    const copy = await service.duplicateProfile('ptyxis', OTHER_UUID);
    const copyValues = fake.store.get(`/org/gnome/Ptyxis/Profiles/${copy}/`);
    expect(copyValues?.get('opacity')).toBe('0.5');
    expect(copyValues?.get('label')).toBe("'Other (copy)'");
    let view = await service.profiles('ptyxis');
    expect(view.profiles.map((p) => p.label)).toEqual([
      'Main',
      'Other',
      'Work',
      'Other (copy)',
    ]);
    expect(view.defaultUuid).toBe(DEFAULT_UUID);

    expect(await status(service.deleteProfile('ptyxis', DEFAULT_UUID))).toBe(
      409,
    );
    await service.deleteProfile('ptyxis', OTHER_UUID);
    expect(runner.commands()).toContain(
      `gsettings reset-recursively org.gnome.Ptyxis.Profile:/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`,
    );
    view = await service.profiles('ptyxis');
    expect(view.profiles.map((p) => p.uuid)).toEqual([
      DEFAULT_UUID,
      created,
      copy,
    ]);
    expect(await status(service.createProfile('ptyxis', 'a\nb'))).toBe(400);
  });

  it('restores a backup and removes profiles created after it', async () => {
    const backup = await service.ensureBackup();
    expect(backup).not.toBeNull();
    const created = await service.createProfile('ptyxis', 'Temp');
    await service.set('ptyxis', { part: 'global' }, 'audible-bell', 'false');
    await service.set(
      'ptyxis',
      { part: 'profile', uuid: OTHER_UUID },
      'opacity',
      '0.9',
    );

    const restored = await service.restore(backup?.ts as string);
    expect(restored).toEqual(['ptyxis']);
    const global = fake.store.get('/org/gnome/Ptyxis/');
    expect(global?.get('audible-bell')).toBeUndefined();
    expect(global?.get('profile-uuids')).toBe(
      `['${DEFAULT_UUID}', '${OTHER_UUID}']`,
    );
    expect(
      fake.store
        .get(`/org/gnome/Ptyxis/Profiles/${OTHER_UUID}/`)
        ?.get('opacity'),
    ).toBe('0.5');
    expect(fake.store.get(`/org/gnome/Ptyxis/Profiles/${created}/`)?.size).toBe(
      0,
    );
    expect(await status(service.restore('20200101T000000Z'))).toBe(404);
  });

  it('lists user and built-in Ptyxis palettes, tolerating a failed gresource', async () => {
    const bin = join(sbx.root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'ptyxis'), '#!/bin/sh\n', { mode: 0o755 });
    const palettes = join(
      sbx.env['XDG_DATA_HOME'],
      'org.gnome.Ptyxis',
      'palettes',
    );
    await mkdir(palettes, { recursive: true });
    await writeFile(join(palettes, 'Mine.palette'), '[Palette]\n');
    const env = { ...sbx.env, PATH: bin };
    const dirs = resolveDirs(env, sbx.home);
    const gres = new RecordingCommandRunner((argv) =>
      argv[0] === 'gresource'
        ? {
            stdout: [
              '/org/gnome/Ptyxis/palettes/Catppuccin Mocha.palette',
              '/org/gnome/Ptyxis/palettes/Ubuntu.palette',
              '/org/gnome/Ptyxis/ui/window.ui',
            ].join('\n'),
          }
        : undefined,
    );
    const withBinary = new GSettingsService(gres, files, dirs, env);
    expect(await withBinary.palettes('ptyxis')).toEqual([
      'Catppuccin Mocha',
      'Mine',
      'Ubuntu',
    ]);
    expect(gres.commands()).toEqual([`gresource list ${join(bin, 'ptyxis')}`]);

    gres.respond(() => ({ code: 1, stderr: 'not a gresource\n' }));
    expect(await withBinary.palettes('ptyxis')).toEqual(['Mine']);
    expect(await status(withBinary.palettes('gnome-terminal'))).toBe(404);
  });
});
