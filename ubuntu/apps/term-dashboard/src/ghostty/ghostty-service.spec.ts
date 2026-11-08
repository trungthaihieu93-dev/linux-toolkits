import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../errors';
import {
  RecordingCommandRunner,
  type CommandResult,
} from '../exec/command-runner';
import { FileStore } from '../files/file-store';
import { resolveDirs } from '../system/environment';
import { createSandbox, type Sandbox } from '../testing/sandbox';
import {
  GhosttyService,
  parseFontList,
  parseGhosttySaveRequest,
  parseThemeList,
} from './ghostty-service';

const DOCS = await readFile(
  join(
    import.meta.dirname,
    '../../../../libs/term-config/src/__fixtures__/ghostty-show-config-docs.txt',
  ),
  'utf8',
);

let sbx: Sandbox;
let runner: RecordingCommandRunner;
let service: GhosttyService;
let effective: string;
let dir: string;
/** Mimic Ghostty 1.2+, which writes a template config.ghostty when none exists. */
let createsTemplate: boolean;

const legacy = () => join(dir, 'config');
const modern = () => join(dir, 'config.ghostty');

function respond(argv: readonly string[]): Partial<CommandResult> {
  if (argv[0] !== 'ghostty') return { code: 1 };
  const args = argv.slice(1).join(' ');
  if (args === '--version')
    return { stdout: 'Ghostty 1.4.0\n\nVersion\n  - version: 1.4.0\n' };
  if (args === '+show-config --default --docs') return { stdout: DOCS };
  if (args.startsWith('+show-config') && createsTemplate) {
    const file = join(dir, 'config.ghostty');
    if (!existsSync(join(dir, 'config')) && !existsSync(file))
      writeFileSync(file, '# template\n');
  }
  if (args === '+show-config') return { stdout: effective };
  if (args === '+list-themes --plain')
    return { stdout: 'Dracula (resources)\nMine (user)\n' };
  if (args === '+list-fonts')
    return {
      stdout:
        'DejaVu Sans\n  DejaVu Sans Bold\n\nJetBrains Mono\n  JetBrains Mono\n',
    };
  if (argv[1] === '+validate-config') return { code: 0 };
  return { code: 1, stderr: `unexpected ${args}` };
}

beforeEach(async () => {
  sbx = await createSandbox('td-ghostty-');
  dir = join(sbx.env['XDG_CONFIG_HOME'], 'ghostty');
  await mkdir(dir, { recursive: true });
  effective = '';
  createsTemplate = false;
  runner = new RecordingCommandRunner(respond);
  service = new GhosttyService(
    runner,
    new FileStore(resolveDirs(sbx.env, sbx.home), runner),
  );
});
afterEach(() => sbx.cleanup());

const mtime = async (path: string) => (await stat(path)).mtimeMs;
const status = (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e: unknown) => (e instanceof HttpError ? e.status : -1),
  );

describe('GhosttyService', () => {
  it('lists both files in load order with entries, includes and conflicts', async () => {
    await writeFile(
      modern(),
      '# mine\nfont-size = 12\nkeybind = ctrl+a=select_all\nconfig-file = ?extra.conf\n',
    );
    await writeFile(
      legacy(),
      'font-size = 14\nkeybind = ctrl+b=copy_to_clipboard\ntheme = Dracula\n',
    );
    effective = 'font-size = 14\ntheme = Dracula\n';
    const view = await service.config();
    expect(view.files.map((f) => [f.id, f.exists])).toEqual([
      ['ghostty', true],
      ['ghostty-legacy', true],
    ]);
    expect(view.files[0].entries[0]).toEqual({
      key: 'font-size',
      value: '12',
      line: 2,
    });
    expect(view.files[0].includes).toEqual([
      { path: 'extra.conf', optional: true, line: 4 },
    ]);
    // keybind repeats (accumulates); font-size conflicts and `config` wins.
    expect(view.conflicts).toEqual([
      {
        key: 'font-size',
        files: ['ghostty', 'ghostty-legacy'],
        winner: 'ghostty-legacy',
      },
    ]);
    expect(view.effective['theme']).toEqual(['Dracula']);
  });

  it('reads the files after Ghostty has written its first-run template', async () => {
    createsTemplate = true;
    const view = await service.config();
    expect(view.files[0]).toMatchObject({ id: 'ghostty', exists: true });
    const result = await service.save({
      edits: [{ op: 'set', key: 'font-size', value: '13' }],
      baseMtimes: { ghostty: view.files[0].mtimeMs, 'ghostty-legacy': null },
    });
    expect(result.results.map((r) => r.fileId)).toEqual(['ghostty']);
    expect(await readFile(modern(), 'utf8')).toContain('font-size = 13');
  });

  it('edits the winning file when both set a key, with a notice', async () => {
    await writeFile(modern(), 'font-size = 12\n');
    await writeFile(legacy(), 'font-size = 14\n');
    effective = 'font-size = 16\n';
    const result = await service.save({
      edits: [{ op: 'set', key: 'font-size', value: '16' }],
      baseMtimes: { 'ghostty-legacy': await mtime(legacy()) },
    });
    expect(result.results.map((r) => r.fileId)).toEqual(['ghostty-legacy']);
    expect(await readFile(legacy(), 'utf8')).toBe('font-size = 16\n');
    expect(await readFile(modern(), 'utf8')).toBe('font-size = 12\n');
    expect(result.warnings).toEqual([expect.stringContaining('set in both')]);
    expect(
      runner
        .commands()
        .some((c) => c.startsWith('ghostty +validate-config --config-file=')),
    ).toBe(true);
  });

  it('puts new keys in config when it exists, else in config.ghostty', async () => {
    await writeFile(modern(), 'font-size = 12\n');
    let preview = await service.preview({
      edits: [{ op: 'set', key: 'theme', value: 'Dracula' }],
      baseMtimes: {},
    });
    expect(preview.previews.map((p) => p.fileId)).toEqual(['ghostty']);
    await writeFile(legacy(), '');
    preview = await service.preview({
      edits: [{ op: 'set', key: 'theme', value: 'Dracula' }],
      baseMtimes: {},
    });
    expect(preview.previews.map((p) => p.fileId)).toEqual(['ghostty-legacy']);
    expect(preview.previews[0].diff).toContain('+theme = Dracula');
    expect(await readFile(legacy(), 'utf8')).toBe('');
  });

  it('moves repeatable keys into one file and supports the clear form', async () => {
    await writeFile(modern(), 'keybind = ctrl+a=select_all\n');
    await writeFile(legacy(), 'keybind = ctrl+b=copy_to_clipboard\n');
    const result = await service.save({
      edits: [
        {
          op: 'setList',
          key: 'keybind',
          values: ['clear', 'ctrl+c=copy_to_clipboard'],
        },
      ],
      baseMtimes: {
        ghostty: await mtime(modern()),
        'ghostty-legacy': await mtime(legacy()),
      },
    });
    expect(result.results.map((r) => r.fileId).sort()).toEqual([
      'ghostty',
      'ghostty-legacy',
    ]);
    expect(await readFile(legacy(), 'utf8')).toBe(
      'keybind = clear\nkeybind = ctrl+c=copy_to_clipboard\n',
    );
    expect(await readFile(modern(), 'utf8')).toBe('');
    expect(result.warnings).toEqual([
      expect.stringContaining('moved to config'),
    ]);
  });

  it('warns after a save when an include still overrides the edited key', async () => {
    await writeFile(legacy(), 'font-size = 14\nconfig-file = override.conf\n');
    // override.conf (read-only to td) sets font-size = 20 after the edit.
    effective = 'font-size = 20\n';
    const result = await service.save({
      edits: [{ op: 'set', key: 'font-size', value: '18' }],
      baseMtimes: { 'ghostty-legacy': await mtime(legacy()) },
    });
    expect(await readFile(legacy(), 'utf8')).toBe(
      'font-size = 18\nconfig-file = override.conf\n',
    );
    expect(result.warnings).toEqual([
      expect.stringContaining('effective value is 20'),
    ]);
  });

  it('removes a key from every file on unset', async () => {
    await writeFile(modern(), 'font-size = 12\n');
    await writeFile(legacy(), 'font-size = 14\ntheme = x\n');
    await service.save({
      edits: [{ op: 'unset', key: 'font-size' }],
      baseMtimes: {
        ghostty: await mtime(modern()),
        'ghostty-legacy': await mtime(legacy()),
      },
    });
    expect(await readFile(modern(), 'utf8')).toBe('');
    expect(await readFile(legacy(), 'utf8')).toBe('theme = x\n');
  });

  it('rejects unknown keys, config-file edits, missing and stale mtimes', async () => {
    await writeFile(legacy(), 'font-size = 14\n');
    const set = (key: string) => [{ op: 'set' as const, key, value: '1' }];
    expect(
      await status(service.save({ edits: set('no-such-key'), baseMtimes: {} })),
    ).toBe(400);
    expect(
      await status(service.save({ edits: set('config-file'), baseMtimes: {} })),
    ).toBe(400);
    expect(
      await status(service.save({ edits: set('font-size'), baseMtimes: {} })),
    ).toBe(400);
    expect(
      await status(
        service.save({
          edits: set('font-size'),
          baseMtimes: { 'ghostty-legacy': 1 },
        }),
      ),
    ).toBe(409);
    expect(await readFile(legacy(), 'utf8')).toBe('font-size = 14\n');
  });

  it('writes nothing when any candidate fails validation', async () => {
    await writeFile(modern(), 'keybind = a=b\n');
    await writeFile(legacy(), 'keybind = c=d\n');
    runner.respond((argv) =>
      argv[1] === '+validate-config' && argv[2].includes('config.ghostty')
        ? { code: 1, stderr: 'bad\n' }
        : respond(argv),
    );
    expect(
      await status(
        service.save({
          edits: [{ op: 'setList', key: 'keybind', values: ['x=y'] }],
          baseMtimes: {
            ghostty: await mtime(modern()),
            'ghostty-legacy': await mtime(legacy()),
          },
        }),
      ),
    ).toBe(422);
    expect(await readFile(modern(), 'utf8')).toBe('keybind = a=b\n');
    expect(await readFile(legacy(), 'utf8')).toBe('keybind = c=d\n');
  });

  it('returns 503 for CLI-backed routes when Ghostty is not installed', async () => {
    runner.respond(() => ({ code: null, notFound: true }));
    expect(await service.version()).toBeNull();
    expect(await status(service.schema())).toBe(503);
    expect(await status(service.themes())).toBe(503);
    expect((await service.config()).effective).toEqual({});
  });

  it('caches the docs schema per version', async () => {
    const schema = await service.schema();
    expect(schema.keys).toHaveLength(211);
    await service.schema();
    expect(runner.commands().filter((c) => c.includes('--docs'))).toHaveLength(
      1,
    );
  });

  it('lists themes and font families', async () => {
    expect(await service.themes()).toEqual({ names: ['Dracula', 'Mine'] });
    expect(await service.fonts()).toEqual({
      names: ['DejaVu Sans', 'JetBrains Mono'],
    });
  });
});

describe('parsers', () => {
  it('parses theme and font lists', () => {
    expect(parseThemeList('A (resources)\nB C (user)\n\n')).toEqual([
      'A',
      'B C',
    ]);
    expect(parseFontList('X\n  X Bold\nY\n')).toEqual(['X', 'Y']);
  });

  it('shape-checks save requests', () => {
    expect(
      parseGhosttySaveRequest({
        edits: [
          { op: 'set', key: 'a', value: 'b' },
          { op: 'unset', key: 'c' },
        ],
        baseMtimes: { ghostty: 1, 'ghostty-legacy': null },
      }),
    ).toEqual({
      edits: [
        { op: 'set', key: 'a', value: 'b' },
        { op: 'unset', key: 'c' },
      ],
      baseMtimes: { ghostty: 1, 'ghostty-legacy': null },
    });
    for (const bad of [
      null,
      { edits: [] },
      { edits: [{ op: 'set', key: 'a' }] },
      { edits: [{ op: 'drop', key: 'a' }] },
      { edits: [{ op: 'unset', key: 'a' }], baseMtimes: { other: 1 } },
      { edits: [{ op: 'unset', key: 'a' }], baseMtimes: { ghostty: 'x' } },
    ]) {
      expect(() => parseGhosttySaveRequest(bad)).toThrow(HttpError);
    }
  });
});
