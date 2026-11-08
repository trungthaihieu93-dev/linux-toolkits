import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** How long a launch code stays valid. */
export const LAUNCH_CODE_TTL_MS = 60_000;
/** Upper bound on unredeemed codes kept in memory (oldest dropped first). */
const MAX_PENDING_CODES = 32;

/**
 * Per-run secrets. The session token authorises API calls and never appears
 * in a URL or argv; the browser gets it by redeeming a single-use launch code
 * from the `#c=` fragment. The instance secret lets a second `td` (which reads
 * it from the 0600 instance file) mint a new launch code.
 */
export interface SessionStore {
  readonly instanceSecret: string;
  mintLaunchCode(): string;
  /** Spend `code`; returns the session token, or null if unknown or expired. */
  redeemLaunchCode(code: string): string | null;
  isSessionToken(candidate: string): boolean;
  isInstanceSecret(candidate: string): boolean;
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
  const token = secret(random);
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
          return token;
        }
      }
      return null;
    },
    isSessionToken: (candidate) => secretsEqual(token, candidate),
    isInstanceSecret: (candidate) => secretsEqual(instanceSecret, candidate),
  };
}
