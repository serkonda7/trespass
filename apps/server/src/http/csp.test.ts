// Browser-side proof (no violation on any page) is the CSP guard in e2e/fixtures.ts.
import { describe, expect, test } from "bun:test";
import { applyCsp, buildCsp } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("CSP", () => {
  test("scripts only from self or with the nonce; no inline or eval", () => {
    const csp = buildCsp("abc");
    const script = directive(csp, "script-src");
    expect(script).toBe("script-src 'self' 'nonce-abc'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "style-src")).not.toContain("unsafe-inline");
    for (const d of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"])
      expect(csp).toContain(d);
    expect(directive(csp, "img-src")).toBe("img-src 'self' blob: data:");
  });

  test("only HTML responses without a policy of their own get it", () => {
    const html = new Headers({ "content-type": "text/html; charset=utf-8" });
    applyCsp(html, "n1");
    expect(html.get("content-security-policy")).toContain("'nonce-n1'");
    const json = new Headers({ "content-type": "application/json" });
    applyCsp(json, "n1");
    expect(json.has("content-security-policy")).toBe(false);
    const file = new Headers({ "content-type": "text/html", "content-security-policy": "sandbox" });
    applyCsp(file, "n1");
    expect(file.get("content-security-policy")).toBe("sandbox");
  });
});
