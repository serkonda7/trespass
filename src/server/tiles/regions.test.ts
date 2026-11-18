import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { Bbox, Point } from "../../lib/geo/types";
import {
  boxGapKm,
  boxSizeKm,
  defaultRng,
  EDGE_MARGIN_KM,
  insideBox,
  insideWithMargin,
  MAX_LAT,
  MERGE_GAP_KM,
  MIN_BOX_KM,
  mergeBoxes,
  needsRegion,
  newRegionBox,
  type RegionLike,
} from "./regions";

const RUNS = 300;
const pointArb = fc.record({
  lat: fc.double({ min: -80, max: 80, noNaN: true, noDefaultInfinity: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
});
const rngArb = fc.array(
  fc.double({ min: 0, max: 0.999999, noNaN: true, noDefaultInfinity: true }),
  {
    minLength: 12,
    maxLength: 12,
  },
);
const seeded = (values: readonly number[]) => {
  let i = 0;
  return () => values[i++] ?? 0.5;
};

const region = (id: string, box: Bbox, status = "ready"): RegionLike => ({ id, ...box, status });

describe("newRegionBox", () => {
  test(`random points: contains the point with >= 5 km margin, >= 20 km per side (${RUNS} runs)`, () => {
    fc.assert(
      fc.property(pointArb, rngArb, (point, values) => {
        const box = newRegionBox(point, seeded(values));
        expect(insideWithMargin(point, box, EDGE_MARGIN_KM)).toBe(true);
        const { widthKm, heightKm } = boxSizeKm(box);
        expect(widthKm).toBeGreaterThanOrEqual(MIN_BOX_KM - 1e-6);
        expect(heightKm).toBeGreaterThanOrEqual(MIN_BOX_KM - 1e-6);
        expect(box.minLat).toBeGreaterThanOrEqual(-MAX_LAT);
        expect(box.maxLat).toBeLessThanOrEqual(MAX_LAT);
      }),
      { numRuns: RUNS },
    );
  });

  test("the point's relative position varies (not constant, not always centred)", () => {
    const point: Point = { lat: 51.4, lon: 7.5 };
    const offsets: number[] = [];
    for (let i = 0; i < 60; i++) {
      const box = newRegionBox(point, defaultRng);
      const span = box.maxLon - box.minLon;
      offsets.push(((point.lon - box.minLon + 360) % 360) / span);
    }
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const variance = offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length;
    expect(variance).toBeGreaterThan(0.01);
    expect(new Set(offsets.map((o) => o.toFixed(3))).size).toBeGreaterThan(20);
    // Privacy check: most boxes are clearly off-centre.
    expect(offsets.filter((o) => Math.abs(o - 0.5) > 0.05).length).toBeGreaterThan(40);
  });

  test("a box near the antimeridian is wrapped, not silently shifted away", () => {
    const point = { lat: 10, lon: 179.99 };
    const box = newRegionBox(point, seeded([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
    expect(box.minLon).toBeGreaterThan(box.maxLon);
    expect(insideWithMargin(point, box)).toBe(true);
    expect(insideBox(point, box)).toBe(true);
  });
});

describe("needsRegion", () => {
  const box: Bbox = { minLat: 50, minLon: 6, maxLat: 52, maxLon: 8 };
  const covered = { lat: 51, lon: 7 };

  test("a point well inside a region needs no new one", () => {
    expect(needsRegion(covered, [region("r", box)])).toBe(false);
  });

  test("a point close to an edge needs a new region", () => {
    expect(needsRegion({ lat: 50.01, lon: 7 }, [region("r", box)])).toBe(true);
    expect(needsRegion({ lat: 51, lon: 7.99 }, [region("r", box)])).toBe(true);
  });

  test("failed and world regions do not cover a point", () => {
    expect(needsRegion(covered, [region("r", box, "failed")])).toBe(true);
    expect(needsRegion(covered, [{ ...region("w", box), kind: "world" }])).toBe(true);
    expect(needsRegion(covered, [])).toBe(true);
  });
});

describe("mergeBoxes", () => {
  const a: Bbox = { minLat: 50, minLon: 6, maxLat: 50.2, maxLon: 6.2 };
  const near: Bbox = { minLat: 50.21, minLon: 6.2, maxLat: 50.4, maxLon: 6.4 };
  const far: Bbox = { minLat: 60, minLon: 6, maxLat: 60.2, maxLon: 6.2 };

  test("overlapping and nearby boxes are merged into one", () => {
    const result = mergeBoxes(a, [region("near", near)]);
    expect(result.mergedIds).toEqual(["near"]);
    expect(result.box.minLat).toBe(50);
    expect(result.box.maxLat).toBe(50.4);
  });

  test("chains are merged repeatedly", () => {
    const chain: Bbox = { minLat: 50.41, minLon: 6.4, maxLat: 50.6, maxLon: 6.6 };
    const result = mergeBoxes(a, [region("near", near), region("chain", chain)]);
    expect(result.mergedIds.sort()).toEqual(["chain", "near"]);
    expect(result.box.maxLat).toBe(50.6);
  });

  test("boxes farther than the gap are left alone", () => {
    expect(boxGapKm(a, far)).toBeGreaterThan(MERGE_GAP_KM);
    expect(mergeBoxes(a, [region("far", far)]).mergedIds).toEqual([]);
  });

  test("a wrapped box merges around the antimeridian", () => {
    const west: Bbox = { minLat: 10, minLon: 179.9, maxLat: 10.2, maxLon: -179.9 };
    const result = mergeBoxes(west, []);
    expect(result.box).toEqual(west);
    expect(insideBox({ lat: 10.1, lon: -179.95 }, result.box)).toBe(true);
  });
});
