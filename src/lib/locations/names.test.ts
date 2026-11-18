import { describe, expect, test } from "bun:test";
import { similarNames, trigramJaccard } from "./names";

describe("name similarity for duplicate detection", () => {
  test("trigram Jaccard is symmetric and in [0, 1]", () => {
    expect(trigramJaccard("Altbau", "Altbau")).toBe(1);
    expect(trigramJaccard("Altbau", "Villa")).toBe(trigramJaccard("Villa", "Altbau"));
    expect(trigramJaccard("Altbau", "Villa")).toBeLessThan(0.5);
  });
  test("diacritics do not matter, substrings count as similar", () => {
    expect(similarNames("Lungenheilstätte", "lungenheilstatte")).toBe(true);
    expect(similarNames("Heilstätte", "Alte Heilstätte")).toBe(true);
    expect(similarNames("Bunker A", "Villa B")).toBe(false);
  });
});
