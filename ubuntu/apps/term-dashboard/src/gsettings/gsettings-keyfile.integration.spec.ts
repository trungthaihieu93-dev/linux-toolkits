import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createActivityBus } from '../exec/activity-bus';
import { ProcessCommandRunner } from '../exec/command-runner';
import { FileStore } from '../files/file-store';
import { resolveDirs } from '../system/environment';
import { createSandbox, haveBinaries, type Sandbox } from '../testing/sandbox';
import { GSettingsService } from './gsettings-service';

/**
 * Real `gsettings` against the keyfile backend in a temp XDG_CONFIG_HOME, so
 * the user's dconf database is never read or written. Skipped (not passed)
 * when gsettings or the Ptyxis schema is missing.
 */
const dataDirs = (
  process.env['XDG_DATA_DIRS'] || '/usr/local/share:/usr/share'
).split(':');
const hasPtyxisSchema = dataDirs.some((d) =>
  existsSync(join(d, 'glib-2.0', 'schemas', 'org.gnome.Ptyxis.gschema.xml')),
);
const ready = hasPtyxisSchema && (await haveBinaries('gsettings'));

describe.skipIf(!ready)(
  'GSettingsService with real gsettings (keyfile backend)',
  () => {
    let sbx: Sandbox;
    let runner: ProcessCommandRunner;
    let service: GSettingsService;

    beforeEach(async () => {
      sbx = await createSandbox('td-gs-keyfile-');
      expect(sbx.env['GSETTINGS_BACKEND']).toBe('keyfile');
      runner = new ProcessCommandRunner(createActivityBus(), sbx.env);
      const dirs = resolveDirs(sbx.env, sbx.home);
      service = new GSettingsService(
        runner,
        new FileStore(dirs, runner),
        dirs,
        sbx.env,
      );
    });
    afterEach(() => sbx.cleanup());

    const listing = async (arg: string) => {
      const r = await runner.run(['gsettings', 'list-recursively', arg]);
      expect(r.code).toBe(0);
      return r.stdout;
    };
    const profileArg = (uuid: string) =>
      `org.gnome.Ptyxis.Profile:/org/gnome/Ptyxis/Profiles/${uuid}/`;

    it('creates, duplicates and deletes profiles, then restores a backup exactly', async () => {
      const main = await service.createProfile('ptyxis', 'Main');
      await service.setDefaultProfile('ptyxis', main);
      await service.set(
        'ptyxis',
        { part: 'profile', uuid: main },
        'opacity',
        '0.75',
      );
      const copy = await service.duplicateProfile('ptyxis', main, 'Copy');
      const scratch = await service.createProfile('ptyxis', 'Scratch');
      await service.deleteProfile('ptyxis', scratch);

      const profiles = await service.profiles('ptyxis');
      expect(profiles.profiles.map((p) => [p.label, p.isDefault])).toEqual([
        ['Main', true],
        ['Copy', false],
      ]);
      const copyView = await service.view('ptyxis', {
        part: 'profile',
        uuid: copy,
      });
      expect(copyView.keys.find((k) => k.name === 'opacity')?.value).toBe(
        '0.75',
      );
      // The keyfile in the sandbox holds the settings.
      const keyfile = join(
        sbx.env['XDG_CONFIG_HOME'],
        'glib-2.0',
        'settings',
        'keyfile',
      );
      expect((await stat(keyfile)).isFile()).toBe(true);

      const before = {
        global: await listing('org.gnome.Ptyxis'),
        main: await listing(profileArg(main)),
        copy: await listing(profileArg(copy)),
        scratch: await listing(profileArg(scratch)),
      };
      const backup = await service.backup();
      expect(backup?.kinds).toEqual(['ptyxis']);

      await service.set('ptyxis', { part: 'global' }, 'audible-bell', 'false');
      await service.set(
        'ptyxis',
        { part: 'profile', uuid: main },
        'opacity',
        '0.5',
      );
      await service.reset('ptyxis', { part: 'profile', uuid: copy }, 'opacity');
      const late = await service.createProfile('ptyxis', 'Late');
      await service.set(
        'ptyxis',
        { part: 'profile', uuid: late },
        'opacity',
        '0.25',
      );

      expect(await service.restore(backup?.ts as string)).toEqual(['ptyxis']);
      expect({
        global: await listing('org.gnome.Ptyxis'),
        main: await listing(profileArg(main)),
        copy: await listing(profileArg(copy)),
        scratch: await listing(profileArg(scratch)),
      }).toEqual(before);
      // The profile created after the backup is gone from the list and reset.
      expect(await listing(profileArg(late))).toBe(before.scratch);
      expect(
        (await service.profiles('ptyxis')).profiles.map((p) => p.uuid),
      ).toEqual([main, copy]);
    });
  },
);
