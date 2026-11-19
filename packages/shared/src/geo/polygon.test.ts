import { describe, expect, test } from "bun:test";
import {
  circleRing,
  closeRing,
  isSimpleRing,
  pointInPolygon,
  ringAreaKm2,
  ringBbox,
  vertexCount,
} from "./polygon";

const square = closeRing([
  [7, 51],
  [7.1, 51],
  [7.1, 51.1],
  [7, 51.1],
]);

describe("polygon helpers", () => {
  test("closeRing closes and dedupes", () => {
    expect(square).toHaveLength(5);
    expect(vertexCount(square)).toBe(4);
    expect(closeRing([...square, [7, 51]])).toHaveLength(5);
  });

  test("point in polygon", () => {
    const poly = { type: "Polygon" as const, coordinates: [square] };
    expect(pointInPolygon({ lat: 51.05, lon: 7.05 }, poly)).toBe(true);
    expect(pointInPolygon({ lat: 51.2, lon: 7.05 }, poly)).toBe(false);
  });

  test("area and bbox", () => {
    // 0.1° × 0.1° at 51°N ≈ 7.0 km × 11.1 km
    expect(ringAreaKm2(square)).toBeGreaterThan(75);
    expect(ringAreaKm2(square)).toBeLessThan(80);
    expect(ringBbox(square)).toEqual({ minLat: 51, minLon: 7, maxLat: 51.1, maxLon: 7.1 });
  });

  test("circle ring has roughly πr²", () => {
    const ring = circleRing({ lat: 50, lon: 8 }, 10);
    expect(Math.abs(ringAreaKm2(ring) - Math.PI * 100)).toBeLessThan(5);
    expect(isSimpleRing(ring)).toBe(true);
  });

  test("bow ties are not simple", () => {
    const bowTie = closeRing([
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(isSimpleRing(bowTie)).toBe(false);
    expect(isSimpleRing(square)).toBe(true);
  });
});
