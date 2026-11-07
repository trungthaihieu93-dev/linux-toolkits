import { spawnSync } from 'node:child_process';
import {
  RecordingRunner,
  rootScript,
  userScript,
  type Logger,
} from '@linux-toolchain/core';
import { createInstallContext } from '../install-context';
import { defaultsFor, mergeChoices } from '../options';
import type { Choices } from '../types';
import { GOLANGCI_LINT_FALLBACK_TAG, go } from './go';

const hasBash = spawnSync('bash', ['--version']).status === 0;
const ctx = { isRoot: true, user: 'alice', home: '/home/alice' };
const logger: Logger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const ALL: Choices = {
  version: 'latest',
  addons: ['gopls', 'golangci-lint', 'delve'],
};

function releaseFetch(tag: string | undefined) {
  return vi.fn(async () =>
    tag === undefined
      ? new Response('rate limited', { status: 403 })
      : new Response(JSON.stringify({ tag_name: tag }), { status: 200 }),
  );
}

function run(
  overrides: Choices = {},
  opts: { fail?: string[]; tag?: string } = {},
) {
  const runner = new RecordingRunner(new Set(opts.fail ?? []));
  const fetchFn = releaseFetch('tag' in opts ? opts.tag : 'v2.20.1');
  const ic = createInstallContext({
    runner,
    ctx,
    logger,
    fetch: fetchFn as unknown as typeof fetch,
    exists: () => false,
    listDir: () => [],
  });
  return {
    runner,
    ic,
    fetchFn,
    done: go.install(ic, mergeChoices(defaultsFor(go), overrides)),
  };
}

describe('go install', () => {
  it('defaults: latest tarball, profile, gopls, golangci-lint (bash parity for Go itself)', async () => {
    const { runner, ic, fetchFn, done } = run();
    await done;
    expect(runner.calls.map((c) => [c.as, c.label])).toEqual([
      ['root', 'go: download + install'],
      ['root', 'go: profile'],
      ['user', 'go: gopls'],
      ['root', 'go: golangci-lint'],
    ]);
    const [tarball, profile, gopls, lint] = runner.calls.map((c) => c.script);
    expect(tarball).toContain(
      "ver=$(curl -fsSL 'https://go.dev/VERSION?m=text' | sed -n 1p)",
    );
    expect(tarball).toContain(
      'curl -fsSL "https://go.dev/dl/${ver}.linux-${arch}.tar.gz" -o "$tmp/go.tgz"',
    );
    expect(tarball).toContain(
      'rm -rf /usr/local/go\ntar -C /usr/local -xzf "$tmp/go.tgz"',
    );
    expect(profile).toContain('/etc/profile.d/devtools-go.sh');
    expect(profile).toContain(
      'export PATH="$PATH:/usr/local/go/bin:$HOME/go/bin"',
    );
    expect(gopls).toContain(
      'export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"',
    );
    expect(gopls).toContain('go install golang.org/x/tools/gopls@latest');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/repos/golangci/golangci-lint/releases/latest',
      expect.anything(),
    );
    expect(lint).toMatch(
      /releases\/download\/v2\.20\.1\/golangci-lint-2\.20\.1-linux-(amd64|arm64)\.tar\.gz/,
    );
    expect(lint).toContain('golangci-lint-2.20.1-checksums.txt');
    expect(lint).toContain('sha256sum -c');
    expect(lint).toContain('/usr/local/bin/golangci-lint --version');
    expect(ic.warnings).toEqual([]);
  });

  it('all add-ons, in choice order; delve via go install', async () => {
    const { runner, done } = run(ALL);
    await done;
    expect(runner.calls.map((c) => c.label)).toEqual([
      'go: download + install',
      'go: profile',
      'go: gopls',
      'go: golangci-lint',
      'go: delve',
    ]);
    expect(runner.calls[4]?.script).toContain(
      'go install github.com/go-delve/delve/cmd/dlv@latest',
    );
  });

  it('falls back to the pinned golangci-lint release and warns when the API fails', async () => {
    const { runner, ic, done } = run(
      { addons: ['golangci-lint'] },
      { tag: undefined },
    );
    await done;
    const version = GOLANGCI_LINT_FALLBACK_TAG.replace(/^v/, '');
    expect(runner.calls[2]?.script).toContain(
      `golangci-lint-${version}-checksums.txt`,
    );
    expect(ic.warnings).toEqual([
      expect.stringContaining(
        'go: could not resolve the latest golangci/golangci-lint',
      ),
    ]);
  });

  it('add-on failures become warnings and the install still resolves', async () => {
    const { runner, ic, done } = run(ALL, {
      fail: ['go: gopls', 'go: golangci-lint'],
    });
    await expect(done).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.label).toBe('go: delve');
    expect(ic.warnings).toEqual([
      expect.stringMatching(/^go: add-on gopls failed: step failed: go: gopls/),
      expect.stringMatching(/^go: add-on golangci-lint failed: /),
    ]);
  });

  it('a failed Go download rejects before any add-on', async () => {
    const { runner, done } = run(ALL, { fail: ['go: download + install'] });
    await expect(done).rejects.toThrow('go: download + install');
    expect(runner.calls).toHaveLength(1);
  });

  it.skipIf(!hasBash)('every script parses with bash -n', async () => {
    const { runner, done } = run(ALL);
    await done;
    for (const call of runner.calls) {
      const res = spawnSync('bash', ['-n'], {
        input:
          call.as === 'root'
            ? rootScript(call.script)
            : userScript(call.script),
      });
      expect(res.status, `${call.label}: ${res.stderr}`).toBe(0);
    }
  });
});
