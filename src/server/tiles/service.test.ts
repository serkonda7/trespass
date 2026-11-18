import { describe, expect, test } from "bun:test";
import { seed } from "../authz/test-fixtures";
import { tileRegions } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { ensureTileRegion, listAdminTileRegions, overBudget } from "./service";

describe("admin tile listing", () => {
  test("contains rounded boxes, sizes and status but no location ids or exact points", () => {
    const db = createTestDb();
    try {
      const secretId = "location-that-must-not-leak";
      seed(db, {
        users: [{ id: "u", role: "member" }],
        locations: [{ id: secretId, ownerId: "u", lat: 51.1234567, lon: 7.7654321 }],
      });
      const created = ensureTileRegion(db, { lat: 51.1234567, lon: 7.7654321 }, { rng: () => 0.5 });
      expect(created).not.toBeNull();
      const result = listAdminTileRegions(db, "/nonexistent/tiles.sqlite");
      expect(result.regions.length).toBe(1);
      const row = result.regions[0]!;
      expect(row.status).toBe("pending");
      expect(row.kind).toBe("region");
      expect(row.minZoom).toBe(7);
      expect(row.maxZoom).toBe(15);
      expect(result.budgetMb).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).not.toContain(secretId);
      expect(json).not.toContain("51.1234567");
      expect(json).not.toContain("7.7654321");
      expect(Number.isInteger(row.minLat * 100)).toBe(true);
      expect(Number.isInteger(row.minLon * 100)).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  test("the region box is not centred on the exact point", () => {
    const db = createTestDb();
    try {
      const point = { lat: 51.1234567, lon: 7.7654321 };
      expect(ensureTileRegion(db, point)).not.toBeNull();
      const row = db.select().from(tileRegions).get()!;
      // With crypto randomness a single box is almost never exactly centred.
      const centreLat = (row.minLat + row.maxLat) / 2;
      expect(Math.abs(centreLat - point.lat)).toBeGreaterThan(0);
    } finally {
      db.$client.close();
    }
  });
});

describe("overBudget", () => {
  test("includes the conservative estimate and the current file size", () => {
    const mb = 1024 * 1024;
    expect(overBudget(50 * mb, 40 * mb, 100)).toBe(false);
    expect(overBudget(50 * mb, 51 * mb, 100)).toBe(true);
    expect(overBudget(0, 64 * mb, 63)).toBe(true);
  });
});
