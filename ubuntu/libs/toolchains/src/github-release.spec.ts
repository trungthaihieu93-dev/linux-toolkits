import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installGithubBinary, latestRelease } from './github-release';

function fakeFetch(respond: () => Response | Promise<Response>) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return respond();
  }) as typeof fetch;
  return { fn, urls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('latestRelease', () => {
  it('returns tag_name from the GitHub API', async () => {
    const { fn, urls } = fakeFetch(() => json({ tag_name: 'v0.24.1' }));
    const warn = vi.fn();
    await expect(
      latestRelease('jesseduffield/lazydocker', 'v0.23.0', fn, {
        onWarn: warn,
      }),
    ).resolves.toBe('v0.24.1');
    expect(urls).toEqual([
      'https://api.github.com/repos/jesseduffield/lazydocker/releases/latest',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP errors', () => json({ message: 'rate limited' }, 403), 'HTTP 403'],
    ['a missing tag', () => json({}), 'response has no usable tag_name'],
    [
      'an unsafe tag',
      () => json({ tag_name: 'v1; rm -rf /' }),
      'response has no usable tag_name',
    ],
    ['invalid JSON', () => new Response('<html>'), 'JSON'],
    [
      'network errors',
      () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
      'ENOTFOUND',
    ],
  ])('falls back on %s with a warning', async (_name, respond, reason) => {
    const { fn } = fakeFetch(respond);
    const warn = vi.fn();
    await expect(
      latestRelease('wagoodman/dive', 'v0.12.0', fn, { onWarn: warn }),
    ).resolves.toBe('v0.12.0');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(
      'could not resolve the latest wagoodman/dive release (',
    );
    expect(message).toContain(reason);
    expect(message).toContain('using v0.12.0');
  });

  it('works without a warning callback', async () => {
    const { fn } = fakeFetch(() => json({}, 500));
    await expect(latestRelease('a/b', '1.0', fn)).resolves.toBe('1.0');
  });

  it('rejects invalid repo and fallback values', async () => {
    const { fn } = fakeFetch(() => json({}));
    await expect(latestRelease('not-a-repo', 'v1', fn)).rejects.toThrow(
      'invalid GitHub repo',
    );
    await expect(latestRelease('a/b', '$(x)', fn)).rejects.toThrow(
      'invalid fallback tag',
    );
  });
});

function bashSyntaxOk(script: string): boolean {
  execFileSync('bash', ['-n'], { input: script });
  return true;
}

describe('installGithubBinary', () => {
  it('tar.gz with a checksums file', () => {
    const script = installGithubBinary({
      url: 'https://github.com/jesseduffield/lazydocker/releases/download/v0.24.1/lazydocker_0.24.1_Linux_x86_64.tar.gz',
      sha256Url:
        'https://github.com/jesseduffield/lazydocker/releases/download/v0.24.1/checksums.txt',
      binName: 'lazydocker',
      archive: 'tar.gz',
    });
    const lines = script.split('\n');
    expect(lines[0]).toBe('(');
    expect(lines.at(-1)).toBe(')');
    expect(script).toContain(`trap 'rm -rf "$tmp"' EXIT`);
    expect(script).toContain(
      `curl -fsSL --retry 3 -o "$tmp"/'lazydocker_0.24.1_Linux_x86_64.tar.gz' 'https://github.com/jesseduffield/`,
    );
    expect(script).toContain(
      `curl -fsSL --retry 3 -o "$tmp/checksums" 'https://github.com/`,
    );
    expect(script).toContain(`sha256sum -c --quiet -`);
    expect(script).toContain(
      `tar -xzf "$tmp"/'lazydocker_0.24.1_Linux_x86_64.tar.gz' -C "$tmp/x"`,
    );
    expect(script).toContain(`src="$tmp/x"/'lazydocker'`);
    expect(script).toContain(
      `install -m 0755 "$src" '/usr/local/bin/lazydocker'`,
    );
    expect(bashSyntaxOk(script)).toBe(true);
  });

  it('zip with innerPath and a custom dest, no checksum', () => {
    const script = installGithubBinary({
      url: 'https://example.com/tool-1.0.zip',
      binName: 'tool',
      dest: '/opt/tool/bin/',
      archive: 'zip',
      innerPath: 'tool-1.0/bin/tool',
    });
    expect(script).toContain(`unzip -q "$tmp"/'tool-1.0.zip' -d "$tmp/x"`);
    expect(script).toContain(`src="$tmp/x"/'tool-1.0/bin/tool'`);
    expect(script).toContain(`install -m 0755 "$src" '/opt/tool/bin/tool'`);
    expect(script).not.toContain('sha256sum');
    expect(bashSyntaxOk(script)).toBe(true);
  });

  it('raw binary', () => {
    const script = installGithubBinary({
      url: 'https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64',
      sha256Url:
        'https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64.sha256',
      binName: 'hadolint',
      archive: 'raw',
    });
    expect(script).toContain(`src="$tmp"/'hadolint-Linux-x86_64'`);
    expect(script).not.toContain('tar ');
    expect(bashSyntaxOk(script)).toBe(true);
  });

  it('rejects unsafe input', () => {
    const base = {
      url: 'https://example.com/a.tar.gz',
      binName: 'a',
      archive: 'tar.gz' as const,
    };
    expect(() =>
      installGithubBinary({ ...base, url: 'http://example.com/a.tar.gz' }),
    ).toThrow('must use https');
    expect(() => installGithubBinary({ ...base, url: 'nope' })).toThrow(
      'invalid asset URL',
    );
    expect(() =>
      installGithubBinary({ ...base, url: 'https://example.com/' }),
    ).toThrow('cannot derive an asset name');
    expect(() =>
      installGithubBinary({ ...base, sha256Url: 'ftp://x/y' }),
    ).toThrow('checksum URL must use https');
    expect(() => installGithubBinary({ ...base, binName: '../x' })).toThrow(
      'invalid binary name',
    );
    expect(() => installGithubBinary({ ...base, dest: 'bin' })).toThrow(
      'dest must be absolute',
    );
    expect(() =>
      installGithubBinary({ ...base, innerPath: '../../etc/passwd' }),
    ).toThrow('innerPath must be relative');
  });
});

describe('installGithubBinary checksum lookup', () => {
  // Runs the generated `expected=$(awk ...)` line against sample checksum files.
  function lookup(asset: string, sums: string): string {
    const awkLine = installGithubBinary({
      url: `https://example.com/${asset}`,
      sha256Url: 'https://example.com/sums',
      binName: 'x',
      archive: 'raw',
    })
      .split('\n')
      .find((l) => l.startsWith('expected='));
    const dir = mkdtempSync(join(tmpdir(), 'ghr-spec-'));
    try {
      writeFileSync(join(dir, 'checksums'), sums);
      return execFileSync('bash', [
        '-c',
        `tmp="$1"; ${awkLine}; printf '%s' "$expected"`,
        'bash',
        dir,
      ]).toString();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('picks the matching line, supports the *binary marker and lone hashes', () => {
    expect(lookup('b.tar.gz', 'aaa  a.tar.gz\nbbb  b.tar.gz\n')).toBe('bbb');
    expect(lookup('b.tar.gz', 'ccc *b.tar.gz\n')).toBe('ccc');
    expect(lookup('b.tar.gz', 'ddd\n')).toBe('ddd');
  });

  it('finds nothing for other or look-alike assets', () => {
    expect(lookup('b.tar.gz', 'aaa  a.tar.gz\n')).toBe('');
    expect(lookup('b.tar.gz', 'aaa  xb.tar.gz\n')).toBe('');
  });
});
