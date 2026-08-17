import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_PENDING = 1_024;
const PKCE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

type PendingMobileAuthCode = {
  userId: string;
  codeChallenge: string;
  expiresAt: number;
};

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function codeDigest(code: string): string {
  return createHash('sha256').update(code, 'ascii').digest('hex');
}

function challengesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'ascii');
  const expectedBuffer = Buffer.from(expected, 'ascii');
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export class MobileAuthCodeStore {
  private readonly pending = new Map<string, PendingMobileAuthCode>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createCode: () => string = () => randomBytes(32).toString('base64url'),
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxPending = DEFAULT_MAX_PENDING
  ) {}

  issue(userId: string, codeChallenge: string): string {
    if (!userId || !PKCE_VALUE_PATTERN.test(codeChallenge)) {
      throw new Error('Invalid mobile authentication request');
    }

    this.pruneExpired();
    while (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.pending.delete(oldest);
    }

    let code = this.createCode();
    let digest = codeDigest(code);
    while (this.pending.has(digest)) {
      code = this.createCode();
      digest = codeDigest(code);
    }

    this.pending.set(digest, {
      userId,
      codeChallenge,
      expiresAt: this.now() + this.ttlMs,
    });
    return code;
  }

  exchange(code: string, verifier: string): string | null {
    if (!PKCE_VALUE_PATTERN.test(code) || !PKCE_VALUE_PATTERN.test(verifier)) return null;

    const digest = codeDigest(code);
    const pending = this.pending.get(digest);
    if (!pending) return null;

    // A code is consumed on the first exchange attempt, successful or not.
    this.pending.delete(digest);
    if (pending.expiresAt <= this.now()) return null;

    const actualChallenge = createPkceChallenge(verifier);
    if (!challengesMatch(actualChallenge, pending.codeChallenge)) return null;
    return pending.userId;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [digest, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(digest);
    }
  }
}

export const mobileAuthCodes = new MobileAuthCodeStore();
