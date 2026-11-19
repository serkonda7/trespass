import { expect, test } from "bun:test";
import { formatDistance, routeLegs, routeTotal } from "./route";

test("legs between consecutive stops, approximate when a point is fuzzed", () => {
  const legs = routeLegs([
    { point: { lat: 51, lon: 7 }, exact: true },
    { point: { lat: 51.1, lon: 7 }, exact: true },
    { point: { lat: 51.2, lon: 7 }, exact: false },
  ]);
  expect(legs).toHaveLength(2);
  expect(Math.round(legs[0]!.meters / 100)).toBe(111);
  expect(legs[0]!.approximate).toBe(false);
  expect(legs[1]!.approximate).toBe(true);
  const total = routeTotal(legs);
  expect(total.approximate).toBe(true);
  expect(Math.round(total.meters / 1000)).toBe(22);
  expect(routeLegs([{ point: { lat: 0, lon: 0 }, exact: true }])).toEqual([]);
});

test("formats distances", () => {
  expect(formatDistance(843)).toBe("840 m");
  expect(formatDistance(12_400)).toBe("12,4 km");
  expect(formatDistance(128_200)).toBe("128 km");
});
