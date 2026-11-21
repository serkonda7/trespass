import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { closeDatabase, KEEP_SNAPSHOTS, openDatabase, pruneSnapshots } from "./client";
import { settings, users } from "./schema";
import { healthStatus } from "./stats";
import { createTestDb } from "./test-db";

describe("migrations", () => {
  test("apply to a fresh in-memory database with all foundation tables", () => {
    const db = createTestDb();
    const names = db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type IN ('table')`)
      .map((r) => r.name);
    for (const t of [
      "boots",
      "settings",
      "users",
      "sessions",
      "accounts",
      "verifications",
      "passkeys",
      "groups",
      "group_members",
      "invites",
      "events",
      "jobs",
    ]) {
      expect(names).toContain(t);
    }
    expect(db.$client.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.select().from(settings).all()).toHaveLength(1);
  });

  test("users get UUIDv7 ids and the settings singleton has trespass defaults", () => {
    const db = createTestDb();
    const u = db
      .insert(users)
      .values({ username: "anna", displayName: "Anna", authEmail: "x@users.invalid" })
      .returning()
      .get();
    expect(u.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    const s = db.select().from(settings).where(sql`id = 1`).get();
    expect(s).toMatchObject({
      instanceName: "Trespass",
      researchBudgetCents: 0,
      tileBudgetMb: 10240,
      defaultFuzzM: 1500,
    });
    // /health tells signed-out callers only `ok` and `boots`.
    expect(healthStatus(db)).toEqual({ ok: true, boots: 0 });
  });
});

describe("pre-migration snapshots (DESIGN §8.6)", () => {
  const { mkdtempSync, readdirSync, writeFileSync, rmSync } = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");

  test("a Phase 0 database (only `boots`) gets a snapshot; only the newest few are kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-snap-"));
    try {
      const path = join(dir, "app.sqlite");
      // Phase 0 database: one table, no migrations recorded.
      const p0 = new Database(path);
      p0.exec("CREATE TABLE boots (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)");
      p0.exec("INSERT INTO boots (at) VALUES ('2026-01-01T00:00:00Z')");
      p0.close();
      const old = [1, 2, 3, 4].map((n) => `app.sqlite.pre-migrate-2026-0${n}-01T00-00-00-000Z.bak`);
      for (const f of [...old, "other.sqlite.pre-migrate-2026-01-01T00-00-00-000Z.bak", "x.bak"])
        writeFileSync(join(dir, f), "");

      const db = openDatabase(path, { snapshotBeforeMigrate: true });
      expect(healthStatus(db).boots).toBe(1);
      closeDatabase(db);

      const files = (readdirSync(dir) as string[]).sort();
      const snaps = files.filter((f) => f.startsWith("app.sqlite.pre-migrate-"));
      expect(snaps).toHaveLength(KEEP_SNAPSHOTS);
      expect(snaps).toContain(old[3]!);
      expect(snaps).not.toContain(old[0]!);
      expect(files).toContain("other.sqlite.pre-migrate-2026-01-01T00-00-00-000Z.bak");
      expect(files).toContain("x.bak");
      const newest = snaps.at(-1)!;
      expect(newest > old[3]!).toBe(true);
      const s = new Database(join(dir, newest), { readonly: true });
      expect(s.query("SELECT count(*) AS n FROM boots").get()).toEqual({ n: 1 });
      s.close();
      expect(files.filter((f) => f.endsWith("-wal") || f.endsWith("-shm"))).toEqual([]);

      closeDatabase(openDatabase(path, { snapshotBeforeMigrate: true }));
      expect(
        (readdirSync(dir) as string[]).filter((f) => f.startsWith("app.sqlite.pre-")).sort(),
      ).toEqual(snaps);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pruneSnapshots keeps everything when there are few", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-snap-"));
    try {
      writeFileSync(join(dir, "app.sqlite.pre-migrate-a.bak"), "");
      expect(pruneSnapshots(join(dir, "app.sqlite"), 3)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
