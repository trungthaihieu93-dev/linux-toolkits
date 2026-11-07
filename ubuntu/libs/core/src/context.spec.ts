import {
  ContextUsageError,
  USER_ENV,
  getentPasswd,
  resolveContext,
} from './context';

const passwd: Record<string, string> = {
  '1000': 'alice:x:1000:1000:Alice:/home/alice:/bin/bash',
  alice: 'alice:x:1000:1000:Alice:/home/alice:/bin/bash',
  bob: 'bob:x:1001:1001::/srv/bob:/bin/zsh',
  '0': 'root:x:0:0:root:/root:/bin/bash',
  root: 'root:x:0:0:root:/root:/bin/bash',
  nohome: 'nohome:x:1002:1002:::/bin/sh',
};
const getent = (key: string) => passwd[key];

describe('resolveContext', () => {
  it('plain user: targets the current user, home from getent', () => {
    const ctx = resolveContext({
      getuid: () => 1000,
      env: { HOME: '/elsewhere' },
      getent,
    });
    expect(ctx).toEqual({ isRoot: false, user: 'alice', home: '/home/alice' });
  });

  it('sudo with SUDO_USER: targets the invoking user', () => {
    const ctx = resolveContext({
      getuid: () => 0,
      env: { SUDO_USER: 'alice', HOME: '/root' },
      getent,
    });
    expect(ctx).toEqual({ isRoot: true, user: 'alice', home: '/home/alice' });
  });

  it('sudo with --user: --user wins over SUDO_USER', () => {
    const ctx = resolveContext({
      user: 'bob',
      getuid: () => 0,
      env: { SUDO_USER: 'alice' },
      getent,
    });
    expect(ctx).toEqual({ isRoot: true, user: 'bob', home: '/srv/bob' });
  });

  it('root with no target user fails with the bash script message', () => {
    const msg =
      'no non-root target user; run via sudo from your account or pass --user NAME';
    expect(() => resolveContext({ getuid: () => 0, env: {}, getent })).toThrow(
      msg,
    );
    expect(() =>
      resolveContext({ getuid: () => 0, env: { SUDO_USER: 'root' }, getent }),
    ).toThrow(msg);
    expect(() =>
      resolveContext({ user: 'root', getuid: () => 0, env: {}, getent }),
    ).toThrow(msg);
    expect(() =>
      resolveContext({ user: '0', getuid: () => 0, env: {}, getent }),
    ).toThrow(msg);
  });

  it('rejects --user without root', () => {
    expect(() =>
      resolveContext({ user: 'bob', getuid: () => 1000, env: {}, getent }),
    ).toThrow('--user needs root');
  });

  it('dry run: a non-root caller may preview --user', () => {
    expect(
      resolveContext({
        user: 'bob',
        dryRun: true,
        getuid: () => 1000,
        env: {},
        getent,
      }),
    ).toEqual({ isRoot: false, user: 'bob', home: '/srv/bob' });
    expect(() =>
      resolveContext({
        user: 'ghost',
        dryRun: true,
        getuid: () => 1000,
        env: {},
        getent,
      }),
    ).toThrow('user not found: ghost');
    expect(() =>
      resolveContext({
        user: 'root',
        dryRun: true,
        getuid: () => 1000,
        env: {},
        getent,
      }),
    ).toThrow('no non-root target user');
  });

  it('marks argument-caused failures as ContextUsageError, others not', () => {
    const usage = (opts: Parameters<typeof resolveContext>[0]) => {
      try {
        resolveContext(opts);
      } catch (error) {
        return error instanceof ContextUsageError;
      }
      throw new Error('expected resolveContext to throw');
    };
    expect(usage({ getuid: () => 0, env: {}, getent })).toBe(true);
    expect(usage({ user: 'bob', getuid: () => 1000, env: {}, getent })).toBe(
      true,
    );
    expect(usage({ user: 'ghost', getuid: () => 0, env: {}, getent })).toBe(
      true,
    );
    expect(
      usage({
        user: 'ghost',
        dryRun: true,
        getuid: () => 1000,
        env: {},
        getent,
      }),
    ).toBe(true);
    expect(usage({ getuid: () => 4242, env: {}, getent })).toBe(false);
    expect(usage({ user: 'nohome', getuid: () => 0, env: {}, getent })).toBe(
      false,
    );
  });

  it('reports unknown users and missing homes', () => {
    expect(() =>
      resolveContext({ user: 'ghost', getuid: () => 0, env: {}, getent }),
    ).toThrow('user not found: ghost');
    expect(() =>
      resolveContext({ getuid: () => 4242, env: {}, getent }),
    ).toThrow('cannot resolve the current user (uid 4242)');
    expect(() =>
      resolveContext({ user: 'nohome', getuid: () => 0, env: {}, getent }),
    ).toThrow('no home directory for user: nohome');
  });

  it('defaults to the real process uid, env and getent', () => {
    // Resolves the account running the tests; skipped in odd sandboxes without a passwd entry.
    const uid = process.getuid?.();
    if (uid === undefined || uid === 0 || !getentPasswd(String(uid))) return;
    const ctx = resolveContext();
    expect(ctx.isRoot).toBe(false);
    expect(ctx.user).toBeTruthy();
    expect(ctx.home.startsWith('/')).toBe(true);
  });
});

describe('getentPasswd', () => {
  it('returns undefined for an unknown user', () => {
    expect(getentPasswd('no-such-user-linux-toolchain-test')).toBeUndefined();
  });
});

describe('USER_ENV', () => {
  it('matches the bash script prelude', () => {
    expect(USER_ENV).toBe(
      'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh";',
    );
  });
});
