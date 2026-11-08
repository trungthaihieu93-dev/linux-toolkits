import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createActivityBus } from '../exec/activity-bus';
import { ProcessCommandRunner } from '../exec/command-runner';
import { FileStore } from '../files/file-store';
import { resolveDirs } from '../system/environment';
import { createSandbox, haveBinaries, type Sandbox } from '../testing/sandbox';
import { GhosttyService } from './ghostty-service';

/** Real `ghostty +validate-config` in a temp XDG_CONFIG_HOME; skipped without ghostty. */
const hasGhostty = await haveBinaries('ghostty');

describe.skipIf(!hasGhostty)('GhosttyService with real ghostty', () => {
  let sbx: Sandbox;
  let service: GhosttyService;
  let config: string;

  beforeEach(async () => {
    sbx = await createSandbox('td-ghostty-real-');
    const runner = new ProcessCommandRunner(createActivityBus(), sbx.env);
    service = new GhosttyService(
      runner,
      new FileStore(resolveDirs(sbx.env, sbx.home), runner),
    );
    await mkdir(join(sbx.env['XDG_CONFIG_HOME'], 'ghostty'), {
      recursive: true,
    });
    config = join(sbx.env['XDG_CONFIG_HOME'], 'ghostty', 'config');
    await writeFile(config, '# sandbox\nfont-size = 13\n');
  });
  afterEach(() => sbx.cleanup());

  it('saves a valid edit and reads it back from +show-config', async () => {
    const result = await service.save({
      edits: [{ op: 'set', key: 'font-size', value: '15' }],
      baseMtimes: { 'ghostty-legacy': (await stat(config)).mtimeMs },
    });
    expect(result.results[0].check).toMatchObject({ ok: true });
    expect(result.results[0].check.argv[1]).toBe('+validate-config');
    expect(await readFile(config, 'utf8')).toBe('# sandbox\nfont-size = 15\n');
    expect((await service.effective())['font-size']).toEqual(['15']);
    expect(result.warnings).toEqual([]);
  }, 30_000);

  it('blocks an invalid value with the validator output', async () => {
    const preview = await service.preview({
      edits: [{ op: 'set', key: 'font-size', value: 'huge' }],
      baseMtimes: {},
    });
    expect(preview.previews[0].check.ok).toBe(false);
    expect(preview.previews[0].check.output).toContain('font-size');
    expect(preview.previews[0].check.output).toContain(config);
    await expect(
      service.save({
        edits: [{ op: 'set', key: 'font-size', value: 'huge' }],
        baseMtimes: { 'ghostty-legacy': (await stat(config)).mtimeMs },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await readFile(config, 'utf8')).toBe('# sandbox\nfont-size = 13\n');
  }, 30_000);
});
