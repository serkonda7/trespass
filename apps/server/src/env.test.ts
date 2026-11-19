import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  test("dev defaults", () => {
    const e = parseEnv({}, "/repo");
    expect(e.ORIGIN).toBe("http://localhost:3000");
    expect(e.DATABASE_PATH).toBe("/repo/data/db/app.sqlite");
    expect(e.UPLOAD_DIR).toBe("/repo/data/uploads");
    expect(e.TILES_PATH).toBe("/repo/data/tiles/tiles.sqlite");
    expect(e.TILES).toBe("on");
    expect(e.PMTILES_BIN).toBeUndefined();
    expect(e.TILES_BUILD_URL).toBeUndefined();
    expect(parseEnv({ TILES_PATH: "/srv/tiles.sqlite" }).TILES_PATH).toBe("/srv/tiles.sqlite");
    expect(
      parseEnv({ TILES: "off", PMTILES_BIN: "/usr/bin/pmtiles", TILES_BUILD_URL: "" }),
    ).toMatchObject({
      TILES: "off",
      PMTILES_BIN: "/usr/bin/pmtiles",
      TILES_BUILD_URL: undefined,
    });
    expect(e.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(e.isProduction).toBe(false);
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.NTFY_URL).toBeUndefined();
    expect(parseEnv({ ANTHROPIC_API_KEY: "sk-test" }).ANTHROPIC_API_KEY).toBe("sk-test");
  });

  test("production requires a real secret", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short" })).toThrow(
      /32 characters/,
    );
    const e = parseEnv({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "x".repeat(40),
      ORIGIN: "https://lp.example.de/",
      SMTP_URL: "",
    });
    expect(e.ORIGIN).toBe("https://lp.example.de");
    expect(e.SMTP_URL).toBeUndefined();
  });

  test("rejects an invalid ORIGIN", () => {
    expect(() => parseEnv({ ORIGIN: "not a url" })).toThrow(/ORIGIN/);
  });
});
