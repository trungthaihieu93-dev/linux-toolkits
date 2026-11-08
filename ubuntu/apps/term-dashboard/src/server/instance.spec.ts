import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findRunningInstance,
  instanceFilePath,
  isProcessAlive,
  readInstanceFile,
  removeInstanceFile,
  requestLaunchCode,
  writeInstanceFile,
  type InstanceInfo,
} from './instance';
import { instanceProof } from './session';

const uid = process.getuid?.() ?? 0;
const info: InstanceInfo = {
  port: 4777,
  pid: 4242,
  instanceSecret: 'a'.repeat(43),
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('instance file', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'td-instance-'));
    file = join(dir, 'term-dashboard', 'instance.json');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('lives in XDG_RUNTIME_DIR, else in ~/.local/state', () => {
    expect(
      instanceFilePath({ XDG_RUNTIME_DIR: '/run/user/1000' }, '/home/u'),
    ).toBe('/run/user/1000/term-dashboard/instance.json');
    expect(instanceFilePath({}, '/home/u')).toBe(
      '/home/u/.local/state/term-dashboard/instance.json',
    );
    expect(instanceFilePath({ XDG_RUNTIME_DIR: 'relative' }, '/home/u')).toBe(
      '/home/u/.local/state/term-dashboard/instance.json',
    );
  });

  it('is written with a 0700 folder and a 0600 file', async () => {
    await writeInstanceFile(file, info);
    expect((await stat(join(dir, 'term-dashboard'))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(info);
    expect(await readInstanceFile(file, uid)).toEqual(info);
  });

  it('tightens an existing folder to 0700 and replaces an old file', async () => {
    await writeInstanceFile(file, { ...info, pid: 1 });
    await chmod(join(dir, 'term-dashboard'), 0o755);
    await writeInstanceFile(file, info);
    expect((await stat(join(dir, 'term-dashboard'))).mode & 0o777).toBe(0o700);
    expect(await readInstanceFile(file, uid)).toEqual(info);
  });

  it('is not trusted with a loose mode, another owner or bad contents', async () => {
    await writeInstanceFile(file, info);
    await chmod(file, 0o644);
    expect(await readInstanceFile(file, uid)).toBeNull();
    await chmod(file, 0o600);
    expect(await readInstanceFile(file, uid + 1)).toBeNull();
    await writeFile(file, '{"port":"x"}');
    expect(await readInstanceFile(file, uid)).toBeNull();
    await writeFile(file, 'not json');
    expect(await readInstanceFile(file, uid)).toBeNull();
  });

  it('reads as null when missing', async () => {
    expect(await readInstanceFile(file, uid)).toBeNull();
  });

  it('is removed only by the instance that owns it', async () => {
    await writeInstanceFile(file, info);
    await removeInstanceFile(file, info.pid + 1, uid);
    expect(await readInstanceFile(file, uid)).toEqual(info);
    await removeInstanceFile(file, info.pid, uid);
    expect(await readInstanceFile(file, uid)).toBeNull();
  });

  describe('findRunningInstance', () => {
    /** Answers like a td that knows `secret`. */
    const answering = (secret: string, pid = info.pid) =>
      vi.fn(async (url: string) => {
        const challenge = new URL(url).searchParams.get('challenge') ?? '';
        return jsonResponse({
          app: 'term-dashboard',
          version: '1',
          pid,
          proof: instanceProof(secret, challenge),
        });
      });
    const healthy = answering(info.instanceSecret);

    it('returns the instance when the pid is alive and health matches', async () => {
      await writeInstanceFile(file, info);
      const found = await findRunningInstance(file, {
        uid,
        fetch: healthy as unknown as typeof fetch,
        isAlive: () => true,
      });
      expect(found).toEqual(info);
      expect(healthy).toHaveBeenCalledWith(
        expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:4777\/api\/health\?challenge=[A-Za-z0-9_-]{43}$/,
        ),
        expect.anything(),
      );
    });

    it('ignores a stale file whose pid is gone', async () => {
      await writeInstanceFile(file, info);
      const fetchFn = vi.fn();
      const found = await findRunningInstance(file, {
        uid,
        fetch: fetchFn as unknown as typeof fetch,
        isAlive: () => false,
      });
      expect(found).toBeNull();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('never trusts another process answering on the port', async () => {
      await writeInstanceFile(file, info);
      for (const fetchFn of [
        // A reused pid: right pid and app name, but no knowledge of the secret.
        async () => jsonResponse({ app: 'term-dashboard', pid: info.pid }),
        answering('b'.repeat(43)),
        answering(info.instanceSecret, 999),
        async () => jsonResponse({ app: 'term-dashboard', pid: 999 }),
        async () => jsonResponse({ app: 'other', pid: info.pid }),
        async () => jsonResponse({}, 500),
        async () => {
          throw new Error('ECONNREFUSED');
        },
      ]) {
        const found = await findRunningInstance(file, {
          uid,
          fetch: fetchFn as unknown as typeof fetch,
          isAlive: () => true,
        });
        expect(found).toBeNull();
      }
    });

    it('returns null without an instance file', async () => {
      const found = await findRunningInstance(file, {
        uid,
        fetch: healthy as unknown as typeof fetch,
        isAlive: () => true,
      });
      expect(found).toBeNull();
    });
  });

  describe('requestLaunchCode', () => {
    it('authenticates with the instance secret', async () => {
      const fetchFn = vi.fn(async () => jsonResponse({ code: 'xyz' }));
      expect(
        await requestLaunchCode(info, fetchFn as unknown as typeof fetch),
      ).toEqual({ code: 'xyz' });
      expect(fetchFn).toHaveBeenCalledWith(
        'http://127.0.0.1:4777/api/launch-code',
        expect.objectContaining({
          method: 'POST',
          headers: {
            authorization: `Bearer ${info.instanceSecret}`,
            'content-type': 'application/json',
          },
          body: '{"page":false}',
        }),
      );
    });

    it('asks for a launch page and returns its path', async () => {
      const fetchFn = vi.fn(async () =>
        jsonResponse({ code: 'xyz', page: '/run/x/launch-1.html' }),
      );
      expect(
        await requestLaunchCode(info, fetchFn as unknown as typeof fetch, {
          page: true,
        }),
      ).toEqual({ code: 'xyz', page: '/run/x/launch-1.html' });
      expect(fetchFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: '{"page":true}' }),
      );
    });

    it('fails on a refusal or an empty answer', async () => {
      await expect(
        requestLaunchCode(info, (async () =>
          jsonResponse({}, 401)) as unknown as typeof fetch),
      ).rejects.toThrow('HTTP 401');
      await expect(
        requestLaunchCode(info, (async () =>
          jsonResponse({})) as unknown as typeof fetch),
      ).rejects.toThrow('no launch code');
    });
  });

  it('detects live and dead pids', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 22 + 1)).toBe(false);
  });

  it.skipIf(uid === 0)('treats a pid owned by another user as not ours', () => {
    // pid 1 (init) belongs to root, so signalling it fails with EPERM.
    expect(isProcessAlive(1)).toBe(false);
  });
});
