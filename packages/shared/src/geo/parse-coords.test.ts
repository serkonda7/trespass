import { describe, expect, test } from "bun:test";
import {
  decodeOpenLocationCode,
  findCoordinateSpans,
  formatCoordinates,
  parseCoordinates,
} from "./parse-coords";

describe("parseCoordinates: decimal pairs", () => {
  test("dot and comma, space/semicolon/comma separators", () => {
    expect(parseCoordinates("51.12345, 7.12345")).toEqual({ lat: 51.12345, lon: 7.12345 });
    expect(parseCoordinates("51.12345 7.12345")).toEqual({ lat: 51.12345, lon: 7.12345 });
    expect(parseCoordinates("51,12345 7,12345")).toEqual({ lat: 51.12345, lon: 7.12345 });
    expect(parseCoordinates("51,12345; 7,12345")).toEqual({ lat: 51.12345, lon: 7.12345 });
    expect(parseCoordinates(" 51.12345,7.12345 ")).toEqual({ lat: 51.12345, lon: 7.12345 });
    expect(parseCoordinates("-33.8688, 151.2093")).toEqual({ lat: -33.8688, lon: 151.2093 });
  });

  test("rejects nonsense and out-of-range values", () => {
    for (const input of [
      "",
      "1923",
      "12,50 €",
      "Tor 3, 2. Stock",
      "51.12345",
      "norden",
      "91.0, 7.0",
      "51.0, 181.0",
    ]) {
      expect(parseCoordinates(input), input).toBeNull();
    }
  });
});

describe("parseCoordinates: DMS and degrees-decimal-minutes", () => {
  test("seconds with hemisphere suffix", () => {
    const p = parseCoordinates(`51°07'24.4"N 7°07'24.4"E`)!;
    expect(p.lat).toBeCloseTo(51 + 7 / 60 + 24.4 / 3600, 6);
    expect(p.lon).toBeCloseTo(7 + 7 / 60 + 24.4 / 3600, 6);
  });
  test("decimal minutes with hemisphere prefix", () => {
    const p = parseCoordinates(`N 51° 7.407' E 7° 7.407'`)!;
    expect(p.lat).toBeCloseTo(51 + 7.407 / 60, 6);
    expect(p.lon).toBeCloseTo(7 + 7.407 / 60, 6);
  });
  test("southern/western hemispheres are negative", () => {
    const p = parseCoordinates(`34°36'20"S 58°22'30"W`)!;
    expect(p.lat).toBeLessThan(0);
    expect(p.lon).toBeLessThan(0);
  });
  test("S as longitude or E as latitude is rejected", () => {
    expect(parseCoordinates(`51°07'N 7°07'S`)).toBeNull();
  });
});

describe("plus codes", () => {
  test("published OLC examples decode to their centres", () => {
    const google = decodeOpenLocationCode("849VCWC8+R9")!;
    expect(google.lat).toBeCloseTo(37.42206, 5);
    expect(google.lon).toBeCloseTo(-122.08406, 5);
    const zurich = parseCoordinates("8FVC9G8F+6X")!;
    expect(zurich.lat).toBeCloseTo(47.36556, 5);
    expect(zurich.lon).toBeCloseTo(8.52494, 5);
    expect(parseCoordinates("9F28WXR4+2V")).toEqual({
      lat: 50.940062499999996,
      lon: 6.9571875,
    });
  });
  test("extra grid digits refine the position", () => {
    const short = decodeOpenLocationCode("9F28WXR4+2V")!;
    const longer = decodeOpenLocationCode("9F28WXR4+2V3")!;
    expect(longer.lat).toBeLessThan(short.lat);
    expect(longer.lon).toBeLessThan(short.lon);
  });
  test("short codes without a reference are rejected", () => {
    for (const c of ["9G8F+6X", "WC8F+6X", "6X", "9F28WX84+2A", "9F28WXR4+2I"]) {
      expect(parseCoordinates(c), c).toBeNull();
    }
  });
});

test("formatCoordinates uses a decimal point and five decimals", () => {
  expect(formatCoordinates({ lat: 51.12345, lon: 7.12345 })).toBe("51.12345, 7.12345");
  expect(formatCoordinates({ lat: 51, lon: 7 })).toBe("51.00000, 7.00000");
  expect(formatCoordinates({ lat: -33.8688, lon: 151.2093 })).toBe("-33.86880, 151.20930");
});

test("findCoordinateSpans finds pairs without flagging years or prices", () => {
  const text = "Tor 3, 2. Stock, 1923, 12,50 € und 51.12345, 7.12345";
  const spans = findCoordinateSpans(text);
  expect(spans.map((s) => s.text)).toEqual(["51.12345, 7.12345"]);
  expect(findCoordinateSpans(`51°07'24.4"N 7°07'24.4"E`)[0]?.kind).toBe("dms");
  expect(findCoordinateSpans("Code 9F28WXR4+2V")[0]?.kind).toBe("plus");
});
