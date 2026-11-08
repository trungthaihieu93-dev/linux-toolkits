import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  ActivityEvent,
  GhosttyConfigView,
  GhosttySaveResult,
  GSettingsSchemaView,
  SaveResult,
  ShellBlockModel,
  ShellFileView,
  ShellName,
  TerminalInventory,
} from '@linux-toolchain/term-config';
import { readPeerUid } from '../src/server/peer-uid';
import {
  exchangeCode,
  openPty,
  useShInSandbox,
} from '../src/testing/pty-client';
import {
  createSandbox,
  haveBinaries,
  pgrepSession,
  until,
  type Sandbox,
} from '../src/testing/sandbox';

/**
 * Runs the built bundle (the file `link:td` exposes and npm would install)
 * with the current runtime against a throwaway HOME, every XDG folder inside
 * it, the keyfile gsettings backend and no graphical session. Nothing here
 * touches the real dotfiles or dconf database.
 */
const packageDir = resolve(
  import.meta.dirname,
  '../../../dist/apps/term-dashboard',
);
const bundle = join(packageDir, 'main.js');

const MANAGED_START = '# >>> term-dashboard >>>';
const MANAGED_END = '# <<< term-dashboard <<<';

const hasZsh = await haveBinaries('zsh');
const hasPtyTools = await haveBinaries('script', 'setpriv', 'stty', 'pgrep');
const hasSs = await haveBinaries('ss');
const hasGhostty = await haveBinaries('ghostty');
const hasPtyxisSchema =
  (await haveBinaries('gsettings')) &&
  (process.env['XDG_DATA_DIRS'] || '/usr/local/share:/usr/share')
    .split(':')
    .some((dir) =>
      existsSync(
        join(dir, 'glib-2.0', 'schemas', 'org.gnome.Ptyxis.gschema.xml'),
      ),
    );

interface TdProcess {
  child: ChildProcess;
  port: number;
  origin: string;
  launchCode: string;
  stdout: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function spawnTd(sbx: Sandbox, args: string[]): ChildProcess {
  return spawn(process.execPath, [bundle, ...args], {
    cwd: sbx.home,
    env: sbx.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Start td on a free port and wait for its launch URL. */
async function startTd(sbx: Sandbox): Promise<TdProcess> {
  const child = spawnTd(sbx, ['--no-open', '--port', '0']);
  let out = '';
  let err = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((done) => child.on('exit', (code, signal) => done({ code, signal })));
  await until(
    () => /#c=/.test(out) || child.exitCode !== null,
    20_000,
    'td launch URL',
  );
  const m =
    /listening on http:\/\/127\.0\.0\.1:(\d+)\nOpen: (http:\/\/127\.0\.0\.1:\d+)\/#c=([A-Za-z0-9_-]+)/.exec(
      out,
    );
  if (!m) throw new Error(`td did not print a launch URL:\n${out}\n${err}`);
  return {
    child,
    port: Number(m[1]),
    origin: m[2],
    launchCode: m[3],
    stdout: () => out,
    exited,
  };
}

/** Run td to completion (for a second start against a running instance). */
function runTd(
  sbx: Sandbox,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawnTd(sbx, args);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  return new Promise((done) =>
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    }),
  );
}

async function stopTd(td: TdProcess | null, signal: NodeJS.Signals) {
  if (!td || td.child.exitCode !== null || td.child.signalCode !== null) return;
  td.child.kill(signal);
  const timer = setTimeout(() => td.child.kill('SIGKILL'), 10_000);
  await td.exited;
  clearTimeout(timer);
}

/** Send a request with headers fetch would not let us forge (Host). */
function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    req.on('error', fail);
    req.end();
  });
}

/** Outcome of a TCP connect to `host:port` within 2 s. */
function tryConnect(
  host: string,
  port: number,
): Promise<'connected' | 'refused' | 'timeout'> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      done('timeout');
    }, 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      done('connected');
    });
    socket.once('error', () => {
      clearTimeout(timer);
      done('refused');
    });
  });
}

/** Every process below `pid`, found through `/proc/<pid>/task/<tid>/children`. */
function descendants(pid: number): number[] {
  const found: number[] = [];
  const walk = (parent: number) => {
    let tasks: string[];
    try {
      tasks = readdirSync(`/proc/${parent}/task`);
    } catch {
      return;
    }
    for (const tid of tasks) {
      let children = '';
      try {
        children = readFileSync(`/proc/${parent}/task/${tid}/children`, 'utf8');
      } catch {
        continue;
      }
      for (const child of children.split(/\s+/).filter(Boolean)) {
        found.push(Number(child));
        walk(Number(child));
      }
    }
  };
  walk(pid);
  return found;
}

function comm(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch {
    return null;
  }
}

/** A pid counts as running unless it is gone or a zombie waiting to be reaped. */
function running(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return false;
  }
}

const EMPTY_MODEL: ShellBlockModel = {
  aliases: [],
  exports: [],
  path: { prepend: [], append: [] },
  history: {},
};

/** The file with every managed-block line (markers included) removed. */
function withoutManagedBlock(text: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(MANAGED_START);
  const end = lines.indexOf(MANAGED_END);
  if (start < 0 || end < start) throw new Error('no managed block');
  lines.splice(start, end - start + 1);
  return lines.join('\n');
}

const trimEnd = (text: string) => text.replace(/\s+$/, '');

describe('td bundle', () => {
  let sbx: Sandbox;
  let td: TdProcess | null = null;
  let token = '';

  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${td?.origin}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await api(path, init);
    const body = await res.text();
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${body}`);
    return JSON.parse(body) as T;
  }

  async function saveShellConfig(
    shell: ShellName,
    fileId: 'bashrc' | 'zshrc',
    model: ShellBlockModel,
  ): Promise<SaveResult> {
    const view = await json<ShellFileView>(
      `/api/shells/${shell}/files/${fileId}`,
    );
    return json<SaveResult>(`/api/shells/${shell}/config/save`, {
      method: 'POST',
      body: JSON.stringify({ fileId, model, baseMtimeMs: view.mtimeMs }),
    });
  }

  beforeAll(async () => {
    if (!existsSync(bundle)) {
      throw new Error(
        `bundle not found at ${bundle}; run \`nx run term-dashboard:e2e\` (it builds first)`,
      );
    }
    sbx = await createSandbox('td-e2e-');
    expect(sbx.env['DISPLAY']).toBeUndefined();
    expect(sbx.env['WAYLAND_DISPLAY']).toBeUndefined();
    expect(sbx.env['GSETTINGS_BACKEND']).toBe('keyfile');
    await useShInSandbox(sbx.env['XDG_CONFIG_HOME']);
    td = await startTd(sbx);
    token = await exchangeCode(td.origin, td.launchCode);
  });

  afterAll(async () => {
    await stopTd(td, 'SIGTERM');
    await sbx?.cleanup();
  });

  it('answers /api/health with its own pid and version', async () => {
    const pkg = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    ) as { version: string };
    const res = await fetch(`${td?.origin}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      app: 'term-dashboard',
      version: pkg.version,
      pid: td?.child.pid,
    });
  });

  it('listens on 127.0.0.1 only', async () => {
    const port = td?.port as number;
    expect(td?.origin).toBe(`http://127.0.0.1:${port}`);

    if (hasSs) {
      const listeners = execFileSync('ss', ['-ltnH'], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[3])
        .filter((local) => local?.endsWith(`:${port}`));
      expect(listeners).toEqual([`127.0.0.1:${port}`]);
    }

    // Every other address of this host must refuse (or drop) the port.
    // Link-local IPv6 addresses need a scope id and are left out.
    const external = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a !== undefined && !a.internal)
      .map((a) => a?.address as string)
      .filter((address) => !address.toLowerCase().startsWith('fe80:'));
    const outcomes = await Promise.all(
      external.map(async (address) => [
        address,
        await tryConnect(address, port),
      ]),
    );
    expect(outcomes.filter(([, outcome]) => outcome === 'connected')).toEqual(
      [],
    );
  });

  it('redeems a launch code once', async () => {
    // The startup code was spent in beforeAll.
    const reuse = await fetch(`${td?.origin}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: td?.launchCode }),
    });
    expect(reuse.status).toBe(401);

    // A second td mints codes with the secret from the 0600 instance file.
    const instance = JSON.parse(
      await readFile(
        join(sbx.env['XDG_RUNTIME_DIR'], 'term-dashboard', 'instance.json'),
        'utf8',
      ),
    ) as { instanceSecret: string };
    const minted = await fetch(`${td?.origin}/api/launch-code`, {
      method: 'POST',
      headers: { authorization: `Bearer ${instance.instanceSecret}` },
    });
    expect(minted.status).toBe(200);
    const { code } = (await minted.json()) as { code: string };

    const redeem = () =>
      fetch(`${td?.origin}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    const first = await redeem();
    expect(first.status).toBe(200);
    // Each redemption gets its own token.
    const second = ((await first.json()) as { token: string }).token;
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(token);
    expect((await redeem()).status).toBe(401);
  });

  it('rejects API calls without the session token', async () => {
    expect((await fetch(`${td?.origin}/api/inventory`)).status).toBe(401);
    const wrong = await fetch(`${td?.origin}/api/inventory`, {
      headers: { authorization: 'Bearer not-the-token' },
    });
    expect(wrong.status).toBe(401);
    expect((await api('/api/inventory')).status).toBe(200);
  });

  it('rejects a foreign Host and a foreign Origin', async () => {
    const port = td?.port as number;
    const auth = { authorization: `Bearer ${token}` };
    expect(
      await rawRequest(port, '/api/health', { host: `evil.example:${port}` }),
    ).toBe(403);
    expect(await rawRequest(port, '/', { host: `evil.example:${port}` })).toBe(
      403,
    );
    expect(
      await rawRequest(port, '/api/inventory', {
        ...auth,
        origin: 'http://evil.example',
      }),
    ).toBe(403);
    await expect(openPty(port, token, 'http://evil.example')).rejects.toThrow(
      'handshake rejected: 403',
    );
  });

  it('serves index.html and its hashed JavaScript', async () => {
    const page = await fetch(`${td?.origin}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    const script = /src="(\/assets\/[\w.-]+-[A-Za-z0-9_-]{8}\.js)"/.exec(html);
    expect(script, html).not.toBeNull();
    const asset = await fetch(`${td?.origin}${script?.[1]}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect((await asset.text()).length).toBeGreaterThan(1000);
  });

  it.skipIf(!hasZsh)(
    'saves zsh Config mode into the managed block with a backup',
    async () => {
      const original = '# user zshrc\nalias ll="ls -l"\nexport EDITOR=vi\n';
      const file = join(sbx.home, '.zshrc');
      await writeFile(file, original);

      const result = await saveShellConfig('zsh', 'zshrc', {
        ...EMPTY_MODEL,
        aliases: [{ name: 'gs', command: 'git status' }],
      });
      expect(result.check.ok).toBe(true);
      expect(result.check.argv.slice(0, 2)).toEqual(['zsh', '-n']);

      const saved = await readFile(file, 'utf8');
      expect(trimEnd(withoutManagedBlock(saved))).toBe(trimEnd(original));
      const block = saved.slice(saved.indexOf(MANAGED_START));
      expect(block).toMatch(/alias gs=.*git status/);

      expect(result.backup).not.toBeNull();
      expect(await readFile(result.backup?.path as string, 'utf8')).toBe(
        original,
      );
      expect(statSync(result.backup?.path as string).mode & 0o777).toBe(0o600);
    },
  );

  it('saves bash Config mode into the managed block with a backup', async () => {
    const original = '# user bashrc\ncase $- in *i*) ;; *) return;; esac\n';
    const file = join(sbx.home, '.bashrc');
    await writeFile(file, original);

    const result = await saveShellConfig('bash', 'bashrc', {
      ...EMPTY_MODEL,
      exports: [{ name: 'TD_E2E', value: '1' }],
      path: { prepend: ['~/bin'], append: [] },
    });
    expect(result.check.ok).toBe(true);
    expect(result.check.argv.slice(0, 2)).toEqual(['bash', '-n']);

    const saved = await readFile(file, 'utf8');
    expect(trimEnd(withoutManagedBlock(saved))).toBe(trimEnd(original));
    expect(saved.slice(saved.indexOf(MANAGED_START))).toContain('TD_E2E');

    expect(result.backup).not.toBeNull();
    expect(await readFile(result.backup?.path as string, 'utf8')).toBe(
      original,
    );
  });

  it('streams started and exited events for a shell save', async () => {
    const abort = new AbortController();
    const res = await api('/api/activity', { signal: abort.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events: ActivityEvent[] = [];
    const reading = (async () => {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data: '))
              events.push(JSON.parse(line.slice(6)) as ActivityEvent);
          }
        }
      }
    })().catch(() => undefined);

    try {
      const since = Date.now();
      await saveShellConfig('bash', 'bashrc', {
        ...EMPTY_MODEL,
        aliases: [{ name: 'td_e2e', command: 'true' }],
      });
      let id = '';
      await until(
        () => {
          const started = events.find(
            (e) =>
              e.type === 'started' &&
              e.ts >= since &&
              e.argv[0] === 'bash' &&
              e.argv[1] === '-n',
          );
          id = started?.id ?? '';
          return events.some((e) => e.type === 'exited' && e.id === id);
        },
        10_000,
        'bash -n started/exited events',
      );
      const exited = events.find((e) => e.type === 'exited' && e.id === id);
      expect(exited).toMatchObject({ type: 'exited', code: 0, signal: null });
    } finally {
      abort.abort();
      await reading;
    }
  });

  it.skipIf(!hasPtyTools)('echoes through the PTY WebSocket', async () => {
    const client = await openPty(td?.port as number, token);
    try {
      await client.ready();
      client.send('echo td-ok\n');
      await until(
        // The typed command is echoed too; the result is what remains.
        () => client.output().replaceAll('echo td-ok', '').includes('td-ok'),
        8000,
        'td-ok output',
      ).catch((error: Error) => {
        throw new Error(
          `${error.message}; terminal output: ${JSON.stringify(client.output())}`,
        );
      });
    } finally {
      client.ws.close();
    }
  });

  it.skipIf(!hasGhostty)(
    'saves a Ghostty setting checked by ghostty +validate-config',
    async (ctx) => {
      const inventory = await json<TerminalInventory>('/api/inventory');
      if (!inventory.ghostty.installed) ctx.skip();
      const view = await json<GhosttyConfigView>('/api/ghostty/config');
      const baseMtimes = Object.fromEntries(
        view.files.map((f) => [f.id, f.mtimeMs]),
      );
      const result = await json<GhosttySaveResult>('/api/ghostty/save', {
        method: 'POST',
        body: JSON.stringify({
          edits: [{ op: 'set', key: 'font-size', value: '13' }],
          baseMtimes,
        }),
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].check.ok).toBe(true);
      expect(result.results[0].check.argv[0]).toMatch(/ghostty$/);
      const written = await readFile(result.results[0].path, 'utf8');
      expect(written).toMatch(/^font-size = 13$/m);
      expect(result.results[0].path.startsWith(sbx.home)).toBe(true);
    },
  );

  it.skipIf(!hasPtyxisSchema)(
    'writes a Ptyxis setting to the keyfile backend only',
    async (ctx) => {
      const inventory = await json<TerminalInventory>('/api/inventory');
      const ptyxis = inventory.terminals.find((t) => t.kind === 'ptyxis');
      if (!ptyxis?.schemas) ctx.skip();
      const global = await json<GSettingsSchemaView>(
        '/api/terminals/ptyxis/global',
      );
      const key = global.keys.find((k) => k.type === 'b');
      if (!key) ctx.skip();
      const next = key?.value === 'true' ? 'false' : 'true';
      const updated = await json<GSettingsSchemaView>(
        '/api/terminals/ptyxis/global',
        {
          method: 'PUT',
          body: JSON.stringify({ key: key?.name, value: next }),
        },
      );
      expect(updated.keys.find((k) => k.name === key?.name)?.value).toBe(next);
      const keyfile = await readFile(
        join(sbx.env['XDG_CONFIG_HOME'], 'glib-2.0', 'settings', 'keyfile'),
        'utf8',
      );
      expect(keyfile).toContain(`${key?.name}=${next}`);
    },
  );

  it('hands a second start over to the running instance', async () => {
    const instanceFile = join(
      sbx.env['XDG_RUNTIME_DIR'],
      'term-dashboard',
      'instance.json',
    );
    expect(statSync(instanceFile).mode & 0o777).toBe(0o600);

    const second = await runTd(sbx, ['--no-open', '--port', '0']);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain(
      `td already running (pid ${td?.child.pid})`,
    );
    expect(second.stdout).not.toContain('listening on');
    const m = new RegExp(
      `^http://127\\.0\\.0\\.1:${td?.port}/#c=([A-Za-z0-9_-]+)$`,
      'm',
    ).exec(second.stdout);
    expect(m, second.stdout).not.toBeNull();
    // Every redemption gets its own token; the first one stays valid.
    const another = await exchangeCode(td?.origin as string, m?.[1] as string);
    expect(another).not.toBe(token);
    const settings = await fetch(`${td?.origin}/api/settings`, {
      headers: { authorization: `Bearer ${another}` },
    });
    expect(settings.status).toBe(200);

    const instance = JSON.parse(await readFile(instanceFile, 'utf8')) as {
      pid: number;
      port: number;
    };
    expect(instance).toMatchObject({ pid: td?.child.pid, port: td?.port });
  });

  it('serves a connection whose /proc/net/tcp owner is the current user', async () => {
    const port = td?.port as number;
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((r) => socket.once('connect', () => r()));
    // The lookup td runs on accept, done here for the same socket.
    expect(
      await readPeerUid(
        {
          address: socket.localAddress as string,
          port: socket.localPort as number,
        },
        { address: '127.0.0.1', port },
      ),
    ).toBe(process.getuid?.());
    const response = await new Promise<string>((resolve) => {
      let data = '';
      socket.on('data', (d: Buffer) => (data += d.toString()));
      socket.on('close', () => resolve(data));
      socket.write(
        `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
    });
    expect(response).toMatch(/^HTTP\/1\.1 200/);
    expect(response).toContain('"app":"term-dashboard"');
  });
});

describe.skipIf(!hasPtyTools)('td stopped by a signal', () => {
  let sbx: Sandbox;
  let td: TdProcess | null = null;

  beforeEach(async () => {
    sbx = await createSandbox('td-e2e-signal-');
    await useShInSandbox(sbx.env['XDG_CONFIG_HOME']);
  });
  afterEach(async () => {
    await stopTd(td, 'SIGKILL');
    td = null;
    await sbx.cleanup();
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const)(
    'leaves no script or shell process behind on %s',
    async (signal, exitCode) => {
      td = await startTd(sbx);
      const pid = td.child.pid as number;
      const token = await exchangeCode(td.origin, td.launchCode);
      const client = await openPty(td.port, token);
      const sid = await client.ready();
      client.send('sleep 300 &\n');
      await until(() => pgrepSession(sid) === 0, 5000, 'background job');
      await until(
        () => descendants(pid).filter((p) => comm(p) === 'sleep').length > 0,
        5000,
        'sleep below td',
      );

      const tree = descendants(pid);
      expect(tree.map(comm)).toContain('script');
      expect(tree).toContain(sid);

      td.child.kill(signal);
      expect((await td.exited).code).toBe(exitCode);
      await until(
        () => tree.every((p) => !running(p)) && pgrepSession(sid) === 1,
        5000,
        `td's terminal processes to end after ${signal}`,
      );
      expect(tree.filter(running)).toEqual([]);
      expect(
        existsSync(
          join(sbx.env['XDG_RUNTIME_DIR'], 'term-dashboard', 'instance.json'),
        ),
      ).toBe(false);
    },
  );
});
