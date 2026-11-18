import { describe, expect, test } from "bun:test";
import { timeZoneForPoint } from "./tz";

describe("timeZoneForPoint (offline)", () => {
  test("well-known cities", () => {
    expect(timeZoneForPoint({ lat: 35.68, lon: 139.69 })).toBe("Asia/Tokyo");
    expect(timeZoneForPoint({ lat: 52.52, lon: 13.405 })).toBe("Europe/Berlin");
    expect(timeZoneForPoint({ lat: 51.5, lon: -0.12 })).toBe("Europe/London");
  });
  test("ocean points get an Etc/ zone", () => {
    const zone = timeZoneForPoint({ lat: 0, lon: -30 });
    expect(zone.startsWith("Etc/")).toBe(true);
  });
});
