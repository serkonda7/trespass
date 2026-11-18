import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { haversineMeters } from "../../lib/geo/distance";
import { fuzzPoint } from "./fuzz";

/** A sequence of deterministic rng values in [0, 1). */
function rng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("fuzzPoint", () => {
  test("rng=0 puts the point at exactly 10% of the radius", () => {
    const exact = { lat: 51, lon: 7 };
    const p = fuzzPoint(exact, 1000, rng([0.25, 0]));
    expect(p.lat).toBeGreaterThan(51);
    expect(haversineMeters(exact, p)).toBeGreaterThan(99);
    expect(haversineMeters(exact, p)).toBeLessThan(101);
  });

  test("never exact and never outside the radius (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        fc.double({ min: 0, max: 0.999999, noNaN: true }),
        (lat, lon, radius, r1, r2) => {
          const point = fuzzPoint({ lat, lon }, radius, rng([r1, r2]));
          const d = haversineMeters({ lat, lon }, point);
          expect(d).toBeGreaterThan(0);
          expect(d).toBeLessThanOrEqual(radius * 1.01);
          expect(point.lat).toBeGreaterThanOrEqual(-90);
          expect(point.lat).toBeLessThanOrEqual(90);
          expect(point.lon).toBeGreaterThanOrEqual(-180);
          expect(point.lon).toBeLessThanOrEqual(180);
        },
      ),
      { numRuns: 300 },
    );
  });

  test("deterministic with an injected rng", () => {
    const exact = { lat: 48.1, lon: 11.5 };
    expect(fuzzPoint(exact, 1500, rng([0.25, 0.64]))).toEqual(
      fuzzPoint(exact, 1500, rng([0.25, 0.64])),
    );
  });

  test("the mean distance uses the sqrt radius (uniform in the disc)", () => {
    const exact = { lat: 51, lon: 7 };
    const values = Array.from({ length: 4000 }, (_, k) => ((k * 7919) % 1000) / 1000);
    const next = rng(values);
    let sum = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      sum += haversineMeters(exact, fuzzPoint(exact, 1000, next));
    }
    // Uniform over the disc: E[d] = 2/3 * R (with the 10% floor, slightly more).
    expect(sum / n).toBeGreaterThan(650);
    expect(sum / n).toBeLessThan(750);
  });

  test("zero radius stays at the exact point", () => {
    expect(fuzzPoint({ lat: 51, lon: 7 }, 0, rng([0.5, 0.5]))).toEqual({ lat: 51, lon: 7 });
  });
});
