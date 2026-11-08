import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** How long a launch code stays valid. */
export const LAUNCH_CODE_TTL_MS = 60_000;
/** Upper bound on unredeemed codes kept in memory (oldest dropped first). */
const MAX_PENDING_CODES = 32;

/** Challenge accepted by `instanceProof` (base64url, 16-128 characters). */
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Per-run secrets. Session tokens authorise API calls and never appear in a
 * URL or argv; the browser gets one by redeeming a single-use launch code
 * from the `#c=` fragment, and every redemption gets its own token. Tokens
 * live until the process ends. The instance secret lets a second `td` (which
 * reads it from the 0600 instance file) mint a new launch code.
 */
export interface SessionStore {
  readonly instanceSecret: string;
  /** Tokens issued so far. */
  readonly sessionCount: number;
  mintLaunchCode(): string;
  /** Spend `code`; returns a new session token, or null if unknown or expired. */
  redeemLaunchCode(code: string): string | null;
  isSessionToken(candidate: string): boolean;
  isInstanceSecret(candidate: string): boolean;
  /** `instanceProof(instanceSecret, challenge)`. */
  instanceProof(challenge: string): string;
}

export interface SessionStoreOptions {
  now?: () => number;
  random?: (bytes: number) => Buffer;
  ttlMs?: number;
}

const secret = (random: (bytes: number) => Buffer): string =>
  random(32).toString('base64url');

const digest = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

/**
 * Proof that the holder knows `secret`, for a caller-chosen challenge:
 * base64url HMAC-SHA256. A second `td` checks it so a process that took
 * over a dead instance's port is not trusted, and never sends the secret
 * before the check passes.
 */
export function instanceProof(secret: string, challenge: string): string {
  return createHmac('sha256', secret)
    .update(challenge, 'utf8')
    .digest('base64url');
}

/** Constant-time string comparison (hashing first equalises the lengths). */
export function secretsEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function createSessionStore(
  options: SessionStoreOptions = {},
): SessionStore {
  const now = options.now ?? Date.now;
  const random = options.random ?? randomBytes;
  const ttlMs = options.ttlMs ?? LAUNCH_CODE_TTL_MS;
  const tokens: string[] = [];
  const instanceSecret = secret(random);
  /** Pending codes and their expiry, in mint order. */
  const pending = new Map<string, number>();

  const purgeExpired = (): void => {
    const t = now();
    for (const [code, expires] of pending) {
      if (expires <= t) pending.delete(code);
    }
  };

  return {
    instanceSecret,
    get sessionCount() {
      return tokens.length;
    },
    mintLaunchCode() {
      purgeExpired();
      while (pending.size >= MAX_PENDING_CODES) {
        const oldest = pending.keys().next().value;
        if (oldest === undefined) break;
        pending.delete(oldest);
      }
      const code = secret(random);
      pending.set(code, now() + ttlMs);
      return code;
    },
    redeemLaunchCode(candidate) {
      purgeExpired();
      for (const code of pending.keys()) {
        if (secretsEqual(code, candidate)) {
          pending.delete(code);
          const token = secret(random);
          tokens.push(token);
          return token;
        }
      }
      return null;
    },
    // Compares against every token, without stopping early.
    isSessionToken: (candidate) =>
      tokens.reduce((ok, t) => secretsEqual(t, candidate) || ok, false),
    isInstanceSecret: (candidate) => secretsEqual(instanceSecret, candidate),
    instanceProof: (challenge) => instanceProof(instanceSecret, challenge),
  };
}
