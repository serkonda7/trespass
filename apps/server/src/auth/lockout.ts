// Per-username sign-in lockout (DESIGN §8.4), on top of Better Auth's per-IP limit.
// - No enumeration: keyed by submitted username, same behavior for unknown users;
//   a locked name answers 429 before the password check.
// - Locks expire (1 min, doubling to 15 min); attempts during a lock don't extend it.
// - Trusted devices (OWASP device cookies) count in a separate bucket, so an
//   attacker can't lock the real user out. Passkeys are never locked.
// - In memory; a restart clears it.
import { timingSafeEqual } from "node:crypto";

export type LockoutConfig = {
  /** Failures within `windowMs` that trigger a lock. */
  threshold: number;
  windowMs: number;
  baseLockMs: number;
  maxLockMs: number;
  /** After this long without failures, the lock escalation starts over. */
  decayMs: number;
  maxKeys: number;
};

export const DEFAULT_LOCKOUT: LockoutConfig = {
  threshold: 5,
  windowMs: 15 * 60_000,
  baseLockMs: 60_000,
  maxLockMs: 15 * 60_000,
  decayMs: 60 * 60_000,
  maxKeys: 10_000,
};

type Entry = {
  failures: number;
  windowStart: number;
  lastFailure: number;
  lockedUntil: number;
  strikes: number;
};

export type LockState = { locked: false } | { locked: true; retryAfterMs: number };

export class LoginLockout {
  private entries = new Map<string, Entry>();
  constructor(readonly config: LockoutConfig = DEFAULT_LOCKOUT) {}

  check(key: string, now = Date.now()): LockState {
    const e = this.entries.get(key);
    if (e && e.lockedUntil > now) return { locked: true, retryAfterMs: e.lockedUntil - now };
    return { locked: false };
  }

  fail(key: string, now = Date.now()) {
    const c = this.config;
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= c.maxKeys) this.prune(now);
      e = { failures: 0, windowStart: now, lastFailure: now, lockedUntil: 0, strikes: 0 };
      this.entries.set(key, e);
    }
    if (e.lockedUntil > now) return; // refused attempts never extend a lock
    if (now - e.lastFailure > c.decayMs) e.strikes = 0;
    if (now - e.windowStart > c.windowMs) {
      e.failures = 0;
      e.windowStart = now;
    }
    e.failures++;
    e.lastFailure = now;
    if (e.failures >= c.threshold) {
      e.lockedUntil = now + Math.min(c.baseLockMs * 2 ** e.strikes, c.maxLockMs);
      e.strikes++;
      e.failures = 0;
      e.windowStart = now;
    }
  }

  succeed(key: string) {
    this.entries.delete(key);
  }

  reset() {
    this.entries.clear();
  }

  private prune(now: number) {
    const c = this.config;
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= now && now - e.lastFailure > c.windowMs) this.entries.delete(k);
    }
    for (const k of this.entries.keys()) {
      if (this.entries.size < c.maxKeys) break;
      this.entries.delete(k);
    }
  }
}

// --- Trusted-device cookie --------------------------------------------------
const MAX_DEVICE_ENTRIES = 5;
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function sign(secret: string, username: string, nonce: string) {
  return new Bun.CryptoHasher("sha256", secret)
    .update(`tr-device:${username}:${nonce}`)
    .digest("base64url");
}

/** Parses `user:nonce:sig,...` and returns the usernames with a valid signature. */
export function trustedUsernames(cookieValue: string | undefined, secret: string): string[] {
  if (!cookieValue) return [];
  const out: string[] = [];
  for (const entry of cookieValue.split(",").slice(0, MAX_DEVICE_ENTRIES)) {
    const [u, nonce, sig] = entry.split(":");
    if (!u || !nonce || !sig) continue;
    const want = Buffer.from(sign(secret, u, nonce));
    const got = Buffer.from(sig);
    if (want.length === got.length && timingSafeEqual(want, got)) out.push(u);
  }
  return out;
}

/** New cookie value that adds `username` (keeps the most recent entries). */
export function addTrustedUsername(
  cookieValue: string | undefined,
  secret: string,
  username: string,
): string {
  const kept = (cookieValue ?? "")
    .split(",")
    .filter((e) => e && e.split(":")[0] !== username && trustedUsernames(e, secret).length === 1);
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
  const entry = `${username}:${nonce}:${sign(secret, username, nonce)}`;
  return [entry, ...kept].slice(0, MAX_DEVICE_ENTRIES).join(",");
}

export function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
