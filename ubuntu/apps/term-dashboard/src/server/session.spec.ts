import {
  createSessionStore,
  instanceProof,
  LAUNCH_CODE_TTL_MS,
  secretsEqual,
} from './session';

describe('createSessionStore', () => {
  it('creates 256-bit base64url secrets that differ per run', () => {
    const a = createSessionStore();
    const b = createSessionStore();
    expect(a.instanceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.instanceSecret).not.toBe(b.instanceSecret);
    expect(a.mintLaunchCode()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('redeems a code once, within its lifetime', () => {
    let t = 0;
    const store = createSessionStore({ now: () => t });
    const code = store.mintLaunchCode();
    t = LAUNCH_CODE_TTL_MS - 1;
    const token = store.redeemLaunchCode(code);
    expect(token).not.toBeNull();
    expect(store.isSessionToken(token as string)).toBe(true);
    expect(store.redeemLaunchCode(code)).toBeNull();

    const late = store.mintLaunchCode();
    t += LAUNCH_CODE_TTL_MS;
    expect(store.redeemLaunchCode(late)).toBeNull();
  });

  it('keeps the token and instance secret apart', () => {
    const store = createSessionStore();
    const token = store.redeemLaunchCode(store.mintLaunchCode()) as string;
    expect(store.isInstanceSecret(token)).toBe(false);
    expect(store.isSessionToken(store.instanceSecret)).toBe(false);
    expect(store.redeemLaunchCode(token)).toBeNull();
  });

  it('issues a distinct token per redemption, each valid until the process ends', () => {
    const store = createSessionStore();
    const a = store.redeemLaunchCode(store.mintLaunchCode()) as string;
    const b = store.redeemLaunchCode(store.mintLaunchCode()) as string;
    expect(a).not.toBe(b);
    expect(store.isSessionToken(a)).toBe(true);
    expect(store.isSessionToken(b)).toBe(true);
    expect(store.sessionCount).toBe(2);
    expect(store.isSessionToken(createSessionStore().instanceSecret)).toBe(
      false,
    );
  });

  it('proves the instance secret for a challenge without revealing it', () => {
    const store = createSessionStore();
    const proof = store.instanceProof('c'.repeat(32));
    expect(proof).toBe(instanceProof(store.instanceSecret, 'c'.repeat(32)));
    expect(proof).not.toContain(store.instanceSecret);
    expect(proof).not.toBe(store.instanceProof('d'.repeat(32)));
    expect(proof).not.toBe(createSessionStore().instanceProof('c'.repeat(32)));
  });

  it('bounds the number of pending codes', () => {
    const store = createSessionStore();
    const first = store.mintLaunchCode();
    for (let i = 0; i < 40; i++) store.mintLaunchCode();
    expect(store.redeemLaunchCode(first)).toBeNull();
    expect(store.redeemLaunchCode(store.mintLaunchCode())).not.toBeNull();
  });
});

describe('secretsEqual', () => {
  it('compares strings of any length', () => {
    expect(secretsEqual('abc', 'abc')).toBe(true);
    expect(secretsEqual('abc', 'abcd')).toBe(false);
    expect(secretsEqual('', 'x')).toBe(false);
  });
});
