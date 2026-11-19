import { describe, expect, test } from "bun:test";
import { findCoordinateLikeText, hasCoordinateLikeText } from "./coord-leak";

describe("findCoordinateLikeText", () => {
  test("finds decimal pairs, DMS, plus codes and map links", () => {
    const text = [
      "Treff 51.12345, 7.12345",
      `oder 51°07'24.4"N 7°07'24.4"E`,
      "sowie 9F28WXR4+2V",
      "https://www.openstreetmap.org/#map=15/51.1/7.2",
      "geo:51.12345,7.12345?z=18",
      "https://maps.google.com/?q=51,7",
    ].join(" ");
    const kinds = findCoordinateLikeText(text).map((m) => m.kind);
    expect(kinds).toContain("decimal");
    expect(kinds).toContain("dms");
    expect(kinds).toContain("plus");
    expect(kinds.filter((k) => k === "link").length).toBeGreaterThanOrEqual(3);
  });

  test("does not flag years, prices, floors or plain numbers", () => {
    for (const text of [
      "1923",
      "12,50 €",
      "Tor 3, 2. Stock",
      " Baujahr 1978, 4 Etagen ",
      "Raum 12, Weg 7",
    ]) {
      expect(findCoordinateLikeText(text), text).toEqual([]);
      expect(hasCoordinateLikeText(text), text).toBe(false);
    }
  });

  test("supports German decimal commas and semicolons", () => {
    expect(findCoordinateLikeText("51,12345 7,12345").map((m) => m.kind)).toEqual(["decimal"]);
    expect(findCoordinateLikeText("51,12345; 7,12345")[0]?.text).toBe("51,12345; 7,12345");
  });

  test("recognises all the map apps from DESIGN §4", () => {
    for (const url of [
      "https://www.google.com/maps/place/voorbeeld",
      "https://maps.apple.com/?ll=51,7",
      "https://osmand.net/map?pin=51,7",
      "https://organicmaps.app/?ll=51,7",
      "https://osm.org/go/ufff",
      "geo:51.1,7.2",
    ]) {
      expect(hasCoordinateLikeText(url), url).toBe(true);
    }
  });
});
