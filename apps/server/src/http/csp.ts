// Strict CSP for HTML pages (DESIGN §8.4). Production only (Vite HMR injects
// unnonced code). Scripts need the request nonce (shared/csp-nonce.ts) or 'self';
// no 'unsafe-inline'/'unsafe-eval'. /files/:id keeps its own stricter policy
// (photos/serve.ts). Uploader previews need img-src blob:.
import { AsyncLocalStorage } from "node:async_hooks";

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    // `style` attributes: SSR markup (tag colours, the nav grid, upload
    // progress) and Kobalte/Solid at runtime (popover position, scroll lock).
    // Attributes cannot load or run anything; <style> and scripts stay strict.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 16 random bytes, base64. */
export function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

const G = globalThis as unknown as { __trespassCsp?: AsyncLocalStorage<string> };
G.__trespassCsp ??= new AsyncLocalStorage<string>();
const storage = G.__trespassCsp;

/** Runs `fn` with `nonce` as the request's CSP nonce (read by currentCspNonce()). */
export function withCspNonce<T>(nonce: string, fn: () => T): T {
  return storage.run(nonce, fn);
}

/** Adds the policy to HTML responses that have none yet. */
export function applyCsp(headers: Headers, nonce: string) {
  const type = headers.get("content-type") ?? "";
  if (!type.startsWith("text/html") || headers.has("content-security-policy")) return;
  headers.set("Content-Security-Policy", buildCsp(nonce));
}
