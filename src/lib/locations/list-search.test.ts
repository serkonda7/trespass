import { describe, expect, test } from "bun:test";
import { listLocationsInput } from "./inputs";
import {
  activeFilterCount,
  cleanLocationSearch,
  parseLocationSearch,
  patchLocationSearch,
  toListInput,
} from "./list-search";

describe("map URL filters", () => {
  test("parses values without throwing and drops invalid statuses", () => {
    expect(parseLocationSearch({})).toEqual({});
    expect(
      parseLocationSearch({
        q: "  heilstätte  ",
        status: ["planned", "nonsense", "planned"],
        category: "cat-industry",
        tag: ["a", "a", "", 5],
        country: "DE",
      }),
    ).toEqual({
      q: "heilstätte",
      status: ["planned"],
      category: ["cat-industry"],
      tag: ["a"],
      country: ["DE"],
    });
  });

  test("caps long lists and tolerates repeated parameters", () => {
    const s = parseLocationSearch({ tag: Array.from({ length: 80 }, (_, i) => `t${i}`) });
    expect(s.tag).toHaveLength(50);
    expect(parseLocationSearch({ status: [null, undefined, "idea"] }).status).toEqual(["idea"]);
  });

  test("patch clears keys and clean removes defaults", () => {
    const s = parseLocationSearch({ status: "idea", tag: "" });
    expect(cleanLocationSearch(s)).toEqual({ status: ["idea"] });
    expect(patchLocationSearch(s, { status: undefined })).toEqual({});
    expect(patchLocationSearch(s, { country: ["DE", "DE"] })).toEqual({
      status: ["idea"],
      country: ["DE"],
    });
  });

  test("maps to the server input with bbox and limit", () => {
    const bbox = { minLat: 1, minLon: 2, maxLat: 3, maxLon: 4 };
    expect(
      toListInput(
        {
          q: "x",
          status: ["idea"],
          category: ["cat-other"],
          tag: ["t"],
          country: ["DE"],
        },
        { bbox },
      ),
    ).toEqual({
      limit: 2000,
      q: "x",
      status: ["idea"],
      categoryId: ["cat-other"],
      tag: ["t"],
      country: ["DE"],
      bbox,
    });
    expect(toListInput({}).limit).toBe(2000);
    // The server schema must accept what the map sends.
    expect(listLocationsInput.safeParse(toListInput({})).success).toBe(true);
  });

  test("counts active filters but not the search text", () => {
    expect(activeFilterCount(parseLocationSearch({ q: "x", status: "idea", tag: "t" }))).toBe(2);
  });
});
