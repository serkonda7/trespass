import { describe, expect, test } from "bun:test";
import { formatHistoryDate } from "./format";
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

  test("formats in German", () => {
    expect(formatHistoryDate("1923-05-12", null, "day")).toBe("12.05.1923");
    expect(formatHistoryDate("1923-05", null, "month")).toBe("Mai 1923");
    expect(formatHistoryDate("1923", "1931", "year")).toBe("1923 – 1931");
    expect(formatHistoryDate("1920", null, "decade")).toBe("1920er");
    expect(formatHistoryDate("1923", null, "circa")).toBe("um 1923");
  });
});
