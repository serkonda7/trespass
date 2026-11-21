import { describe, expect, test } from "bun:test";
import { bboxAround, haversineMeters, splitBbox } from "./distance";

describe("haversineMeters", () => {
  test("known distances", () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    // One degree of latitude is about 111.2 km.
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -2);
    expect(haversineMeters({ lat: 51, lon: 7 }, { lat: 51, lon: 8 })).toBeGreaterThan(60_000);
    expect(haversineMeters({ lat: 51, lon: 7 }, { lat: 51, lon: 8 })).toBeLessThan(80_000);
  });
});

describe("bboxAround / splitBbox", () => {
  test("contains the centre and has the expected size", () => {
    const box = bboxAround({ lat: 50, lon: 7 }, 1500);
    expect(box.minLat).toBeLessThan(50);
    expect(box.maxLat).toBeGreaterThan(50);
    expect(box.minLon).toBeLessThan(7);
    expect(box.maxLon).toBeGreaterThan(7);
    expect(splitBbox(box)).toEqual([box]);
  });
  test("splits a box crossing the antimeridian into two", () => {
    const boxes = splitBbox({ minLat: 10, maxLat: 11, minLon: 179.9, maxLon: -179.9 });
    expect(boxes).toEqual([
      { minLat: 10, maxLat: 11, minLon: 179.9, maxLon: 180 },
      { minLat: 10, maxLat: 11, minLon: -180, maxLon: -179.9 },
    ]);
  });
  test("bboxAround near the antimeridian produces a split box", () => {
    const box = bboxAround({ lat: 0, lon: 179.99 }, 2000);
    expect(splitBbox(box)).toHaveLength(2);
  });
  test("near the poles the longitude range is global", () => {
    const box = bboxAround({ lat: 89.9, lon: 7 }, 100_000);
    expect(box.minLon).toBe(-180);
    expect(box.maxLon).toBe(180);
  });
});
