import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  API_PATHS,
  type TerminalInventory,
} from '@linux-toolchain/term-config';
import { RecordingCommandRunner } from '../../exec/command-runner';
import { createSandbox, type Sandbox } from '../../testing/sandbox';
import { createApp } from '../app';
import { createServices } from '../services';
import { createSessionStore } from '../session';

const PORT = 4777;

let sbx: Sandbox;
let runner: RecordingCommandRunner;
let request: (path: string, init?: RequestInit) => Promise<Response>;

beforeEach(async () => {
  sbx = await createSandbox('td-routes-');
  // Every check passes; ghostty, ptyxis and gsettings are "not installed".
  runner = new RecordingCommandRunner((argv) =>
    ['ghostty', 'gsettings', 'ptyxis', 'gnome-terminal'].includes(argv[0])
      ? { code: null, notFound: true }
      : undefined,
  );
  const session = createSessionStore();
  const token = session.redeemLaunchCode(session.mintLaunchCode()) as string;
  const app = createApp({
    session,
    policy: { port: () => PORT },
    version: '0.0.0',
    pid: 1,
    webRoot: null,
    services: createServices({
      env: { ...sbx.env, XDG_DATA_DIRS: join(sbx.root, 'no-schemas') },
      home: sbx.home,
      runner,
      loginShell: () => '/usr/bin/zsh',
    }),
  });
  request = (path, init = {}) =>
    app.request(path, {
      ...init,
      headers: {
        host: `127.0.0.1:${PORT}`,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string>),
      },
    });
});
afterEach(() => sbx.cleanup());

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('API routes', () => {
  it('requires the session token', async () => {
    const res = await request(API_PATHS.inventory, {
      headers: { authorization: '' },
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ['GET', '/api/terminals/konsole/global'],
    ['GET', '/api/shells/fish/files/zshrc'],
    ['GET', '/api/shells/bash/files/passwd'],
    ['GET', '/api/shells/bash/files/zshrc'],
    ['GET', '/api/backups/files/bashrc/..%2F..'],
    ['POST', '/api/backups/gsettings/latest/restore'],
    ['GET', '/api/shells/bash/oh-my-zsh'],
  ])('rejects invalid identifiers: %s %s', async (method, path) => {
    const res = await request(path, { method });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('validates bodies', async () => {
    expect(
      (await request(API_PATHS.settings, json('PUT', { theme: 'blue' })))
        .status,
    ).toBe(400);
    expect(
      (await request(API_PATHS.settings, json('PUT', '{bad'))).status,
    ).toBe(400);
    const raw = API_PATHS.shellRaw('bash', 'save');
    expect(
      (
        await request(
          raw,
          json('POST', { fileId: 'bashrc', content: 1, baseMtimeMs: null }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          raw,
          json('POST', { fileId: 'bashrc', content: '', baseMtimeMs: 'x' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          API_PATHS.shellConfig('bash', 'preview'),
          json('POST', { fileId: 'bashrc', model: {} }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await request(API_PATHS.ghosttySave, json('POST', { edits: 'x' })))
        .status,
    ).toBe(400);
  });

  it('reads and updates settings', async () => {
    expect(await (await request(API_PATHS.settings)).json()).toEqual({
      theme: 'dark',
      port: 4777,
    });
    const res = await request(
      API_PATHS.settings,
      json('PUT', { theme: 'light' }),
    );
    expect(await res.json()).toEqual({ theme: 'light', port: 4777 });
  });

  it('reports the inventory', async () => {
    await writeFile(join(sbx.home, '.zshrc'), 'source $ZSH/oh-my-zsh.sh\n');
    const inv = (await (
      await request(API_PATHS.inventory)
    ).json()) as TerminalInventory;
    expect(inv.home).toBe(sbx.home);
    expect(inv.ghostty).toMatchObject({ installed: false, version: null });
    expect(inv.ghostty.files.map((f) => f.id)).toEqual([
      'ghostty',
      'ghostty-legacy',
    ]);
    expect(inv.terminals.map((t) => [t.kind, t.schemas])).toEqual([
      ['ptyxis', null],
      ['gnome-terminal', null],
    ]);
    const zsh = inv.shells.find((s) => s.shell === 'zsh');
    expect(zsh).toMatchObject({
      isLoginShell: true,
      ohMyZsh: true,
      managedBlock: false,
    });
    expect(typeof inv.pty.available).toBe('boolean');
  });

  it('returns 503 when a feature is not installed', async () => {
    expect((await request(API_PATHS.ghosttySchema)).status).toBe(503);
    expect((await request(API_PATHS.terminalGlobal('ptyxis'))).status).toBe(
      503,
    );
  });

  it('previews and saves a raw file, then lists and restores its backup', async () => {
    const rc = join(sbx.home, '.bashrc');
    await writeFile(rc, 'echo one\n');
    const mtime = (await stat(rc)).mtimeMs;
    const preview = await request(
      API_PATHS.shellRaw('bash', 'preview'),
      json('POST', {
        fileId: 'bashrc',
        content: 'echo two\n',
        baseMtimeMs: mtime,
      }),
    );
    const body = await preview.json();
    expect(body.diff).toContain('+echo two');
    expect(body.backupDir).toBe(
      join(sbx.env['XDG_STATE_HOME'], 'term-dashboard', 'backups'),
    );
    const stale = await request(
      API_PATHS.shellRaw('bash', 'save'),
      json('POST', {
        fileId: 'bashrc',
        content: 'echo two\n',
        baseMtimeMs: mtime - 1000,
      }),
    );
    expect(stale.status).toBe(409);
    const saved = await request(
      API_PATHS.shellRaw('bash', 'save'),
      json('POST', {
        fileId: 'bashrc',
        content: 'echo two\n',
        baseMtimeMs: mtime,
      }),
    );
    expect(saved.status).toBe(200);
    expect(await readFile(rc, 'utf8')).toBe('echo two\n');

    const backups = await (await request(API_PATHS.backups)).json();
    expect(backups.files).toHaveLength(1);
    const { ts } = backups.files[0];
    const content = await (
      await request(API_PATHS.backupFile('bashrc', ts))
    ).json();
    expect(content.content).toBe('echo one\n');
    const restored = await request(
      `${API_PATHS.backupFile('bashrc', ts)}/restore`,
      { method: 'POST' },
    );
    expect(restored.status).toBe(200);
    expect(await readFile(rc, 'utf8')).toBe('echo one\n');
  });

  it('accepts large file bodies only on file routes', async () => {
    const big = 'x'.repeat(100 * 1024);
    const raw = await request(
      API_PATHS.shellRaw('bash', 'preview'),
      json('POST', {
        fileId: 'bashrc',
        content: `# ${big}\n`,
        baseMtimeMs: null,
      }),
    );
    expect(raw.status).toBe(200);
    const settings = await request(
      API_PATHS.settings,
      json('PUT', { theme: big }),
    );
    expect(settings.status).toBe(413);
  });

  it('serves the oh-my-zsh catalog for zsh', async () => {
    const res = await request(API_PATHS.ohMyZsh('zsh'));
    expect(await res.json()).toEqual({ root: null, themes: [], plugins: [] });
  });

  it('lists Ptyxis palettes from the user folder and 404s GNOME Terminal', async () => {
    const dir = join(sbx.env['XDG_DATA_HOME'], 'org.gnome.Ptyxis', 'palettes');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'Mine.palette'), '[Palette]\nName=Mine\n');
    await writeFile(join(dir, 'notes.txt'), 'not a palette');
    const res = await request(API_PATHS.terminalPalettes('ptyxis'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ names: ['Mine'] });
    expect(
      (await request(API_PATHS.terminalPalettes('gnome-terminal'))).status,
    ).toBe(404);
  });
});
