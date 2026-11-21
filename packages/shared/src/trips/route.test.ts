import { expect, test } from "bun:test";
import { routeLegs, routeTotal } from "./route";

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
