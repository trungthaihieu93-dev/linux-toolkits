import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HttpError } from '../errors';
import { createSandbox, type Sandbox } from '../testing/sandbox';
import { DEFAULT_SETTINGS, SettingsStore } from './settings-store';

let sbx: Sandbox;
let store: SettingsStore;

beforeEach(async () => {
  sbx = await createSandbox('td-settings-');
  store = new SettingsStore(sbx.env['XDG_CONFIG_HOME']);
});
afterEach(() => sbx.cleanup());

describe('SettingsStore', () => {
  it('returns defaults when the file is missing or invalid', async () => {
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
    await mkdir(dirname(store.path), { recursive: true });
    await writeFile(store.path, '{not json');
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and replaces invalid ones with defaults', async () => {
    await mkdir(dirname(store.path), { recursive: true });
    await writeFile(
      store.path,
      JSON.stringify({
        theme: 'light',
        port: 99999,
        terminalShell: 'zsh',
        extra: 1,
      }),
    );
    expect(await store.read()).toEqual({
      theme: 'light',
      port: DEFAULT_SETTINGS.port,
    });
  });

  it('writes a validated partial update atomically', async () => {
    const next = await store.update({
      theme: 'light',
      terminalShell: '/usr/bin/zsh',
    });
    expect(next).toEqual({
      theme: 'light',
      port: DEFAULT_SETTINGS.port,
      terminalShell: '/usr/bin/zsh',
    });
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual(next);
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    expect(
      (await readdir(dirname(store.path))).filter((n) => n.endsWith('.tmp')),
    ).toEqual([]);
    expect(await store.update({ terminalShell: null })).toEqual({
      theme: 'light',
      port: DEFAULT_SETTINGS.port,
    });
  });

  it.each([
    [{ theme: 'blue' }],
    [{ port: -1 }],
    [{ port: 1.5 }],
    [{ terminalShell: 'relative/sh' }],
    [{ unknown: true }],
    [[]],
    ['text'],
  ])('rejects %j', async (body) => {
    await expect(store.update(body)).rejects.toBeInstanceOf(HttpError);
  });
});
