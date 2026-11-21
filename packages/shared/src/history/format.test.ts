import { describe, expect, test } from "bun:test";
import { isHistoryDate, normalizeHistoryDate } from "./inputs";

describe("history dates", () => {
  test("validates per precision", () => {
    expect(isHistoryDate("1923-05-12", "day")).toBe(true);
    expect(isHistoryDate("1923-02-30", "day")).toBe(false);
    expect(isHistoryDate("1923-05", "month")).toBe(true);
    expect(isHistoryDate("1923-13", "month")).toBe(false);
    expect(isHistoryDate("1923", "year")).toBe(true);
    expect(isHistoryDate("1923-05", "year")).toBe(false);
    expect(isHistoryDate("0000", "circa")).toBe(false);
  });

  test("decades normalize to their first year", () => {
    expect(normalizeHistoryDate("1923", "decade")).toBe("1920");
    expect(normalizeHistoryDate("1923", "year")).toBe("1923");
  });
});
