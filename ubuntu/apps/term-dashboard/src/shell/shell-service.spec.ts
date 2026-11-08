import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  emptyShellModel,
  type ShellBlockModel,
} from '@linux-toolchain/term-config';
import { HttpError } from '../errors';
import { createActivityBus } from '../exec/activity-bus';
import { ProcessCommandRunner } from '../exec/command-runner';
import { FileStore } from '../files/file-store';
import { resolveDirs } from '../system/environment';
import { createSandbox, haveBinaries, type Sandbox } from '../testing/sandbox';
import { parseShellBlockModel, ShellService } from './shell-service';

const hasZsh = await haveBinaries('zsh');
const hasBash = await haveBinaries('bash');

let sbx: Sandbox;
let service: ShellService;

beforeEach(async () => {
  sbx = await createSandbox('td-shell-');
  const runner = new ProcessCommandRunner(createActivityBus(), sbx.env);
  const files = new FileStore(resolveDirs(sbx.env, sbx.home), runner);
  service = new ShellService(files, sbx.env, sbx.home);
});
afterEach(() => sbx.cleanup());

const zshrc = () => join(sbx.home, '.zshrc');
const model = (patch: Partial<ShellBlockModel> = {}): ShellBlockModel => ({
  ...emptyShellModel(),
  ...patch,
});

const ZSHRC = [
  'export ZSH="$HOME/.oh-my-zsh"',
  'ZSH_THEME="robbyrussell"',
  'plugins=(git)',
  'source $ZSH/oh-my-zsh.sh',
  "alias gs='git status'",
  '',
].join('\n');

describe('ShellService', () => {
  it('rejects files of the other shell and Config mode on non-config files', async () => {
    await expect(service.fileView('bash', 'zshrc')).rejects.toBeInstanceOf(
      HttpError,
    );
    await expect(
      service.previewConfig('zsh', 'zshenv', model()),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('describes a zsh file with oh-my-zsh and outside lines', async () => {
    await writeFile(zshrc(), ZSHRC);
    const view = await service.fileView('zsh', 'zshrc');
    expect(view).toMatchObject({
      exists: true,
      configMode: true,
      blocks: { main: { present: false }, omz: { present: false } },
      ohMyZsh: { detected: true, sourceLine: 4, editable: true },
    });
    expect(view.outside.map((o) => o.kind)).toContain('alias');
    expect(view.model).toEqual(emptyShellModel());
  });

  it.skipIf(!hasZsh)(
    'saves a Config-mode alias inside the managed block only',
    async () => {
      await writeFile(zshrc(), ZSHRC);
      const view = await service.fileView('zsh', 'zshrc');
      const m = model({
        aliases: [{ name: 'll', command: 'ls -la' }],
        ohMyZsh: { theme: 'agnoster', plugins: ['git', 'docker'] },
      });
      const preview = await service.previewConfig('zsh', 'zshrc', m);
      expect(preview.check.ok).toBe(true);
      expect(preview.diff).toContain('+alias ll=');
      const result = await service.saveConfig('zsh', 'zshrc', m, view.mtimeMs);
      expect(result.backup?.fileId).toBe('zshrc');
      const text = await readFile(zshrc(), 'utf8');
      expect(text).toContain('# >>> term-dashboard >>>');
      expect(text).toContain("alias ll='ls -la'");
      // The omz block sits right above the source line; the rest is untouched.
      const lines = text.split('\n');
      const source = lines.indexOf('source $ZSH/oh-my-zsh.sh');
      expect(lines[source - 1]).toBe('# <<< term-dashboard-omz <<<');
      expect(text).toContain("alias gs='git status'");
      expect((await service.fileView('zsh', 'zshrc')).model?.aliases).toEqual([
        { name: 'll', command: 'ls -la' },
      ]);
    },
  );

  it('rejects an invalid model with 400', async () => {
    await expect(
      service.previewConfig(
        'bash',
        'bashrc',
        model({ aliases: [{ name: 'bad name', command: 'x' }] }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.skipIf(!hasBash)('blocks a raw save with a syntax error', async () => {
    await writeFile(join(sbx.home, '.bashrc'), 'echo ok\n');
    const view = await service.fileView('bash', 'bashrc');
    const preview = await service.previewRaw(
      'bash',
      'bashrc',
      'if [ x ]; then\n',
    );
    expect(preview.check.ok).toBe(false);
    await expect(
      service.saveRaw('bash', 'bashrc', 'if [ x ]; then\n', view.mtimeMs),
    ).rejects.toMatchObject({ status: 422 });
    expect(await readFile(join(sbx.home, '.bashrc'), 'utf8')).toBe('echo ok\n');
  });

  it('lists oh-my-zsh themes and plugins, including custom ones', async () => {
    const root = join(sbx.home, '.oh-my-zsh');
    await mkdir(join(root, 'themes'), { recursive: true });
    await mkdir(join(root, 'plugins', 'git'), { recursive: true });
    await mkdir(join(root, 'plugins', 'example'), { recursive: true });
    await mkdir(join(root, 'custom', 'themes'), { recursive: true });
    await mkdir(join(root, 'custom', 'plugins', 'zsh-autosuggestions'), {
      recursive: true,
    });
    await writeFile(join(root, 'oh-my-zsh.sh'), '');
    await writeFile(join(root, 'themes', 'robbyrussell.zsh-theme'), '');
    await writeFile(join(root, 'custom', 'themes', 'mine.zsh-theme'), '');
    expect(await service.ohMyZshCatalog('zsh')).toEqual({
      root,
      themes: ['mine', 'robbyrussell'],
      plugins: ['git', 'zsh-autosuggestions'],
    });
    await expect(service.ohMyZshCatalog('bash')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('returns an empty catalog without oh-my-zsh', async () => {
    expect(await service.ohMyZshCatalog('zsh')).toEqual({
      root: null,
      themes: [],
      plugins: [],
    });
  });
});

describe('parseShellBlockModel', () => {
  it('accepts a full model', () => {
    const m = {
      aliases: [{ name: 'll', command: 'ls' }],
      exports: [{ name: 'EDITOR', value: 'vim' }],
      path: { prepend: ['~/bin'], append: [] },
      history: { size: 1000, ignoreDups: true },
      ohMyZsh: { theme: 'x', plugins: ['git'] },
      extra: ['# kept'],
    };
    expect(parseShellBlockModel(m)).toEqual(m);
  });

  it.each([
    [null],
    [{ aliases: 'x', exports: [], path: { prepend: [], append: [] } }],
    [
      {
        aliases: [{ name: 1 }],
        exports: [],
        path: { prepend: [], append: [] },
      },
    ],
    [{ aliases: [], exports: [], path: { prepend: [1], append: [] } }],
    [
      {
        aliases: [],
        exports: [],
        path: { prepend: [], append: [] },
        history: { size: -1 },
      },
    ],
    [
      {
        aliases: [],
        exports: [],
        path: { prepend: [], append: [] },
        ohMyZsh: { plugins: 'git' },
      },
    ],
  ])('rejects %j', (value) => {
    expect(() => parseShellBlockModel(value)).toThrow(HttpError);
  });
});
