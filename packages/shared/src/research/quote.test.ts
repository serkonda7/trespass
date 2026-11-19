import { describe, expect, test } from "bun:test";
import { normalizeForQuote, quoteAppearsIn } from "./quote";

const page = `Die Heilstätte wurde   1923 eröffnet.
Nach dem „Zweiten Weltkrieg“ diente sie als Lazarett – bis 1994.`;

describe("quote checks", () => {
  test("accepts exact quotes across whitespace, case and typography", () => {
    expect(quoteAppearsIn("die heilstätte wurde 1923 eröffnet", page)).toBe(true);
    expect(
      quoteAppearsIn('nach dem "Zweiten Weltkrieg" diente sie als Lazarett - bis 1994', page),
    ).toBe(true);
  });

  test("rejects paraphrases, made-up and too-short quotes", () => {
    expect(quoteAppearsIn("Die Heilstätte eröffnete 1923", page)).toBe(false);
    expect(quoteAppearsIn("Die Heilstätte wurde 1995 abgerissen", page)).toBe(false);
    expect(quoteAppearsIn("1923", page)).toBe(false);
  });

  test("normalizes NFKC and soft hyphens", () => {
    expect(normalizeForQuote("Heil­stätte")).toBe("heilstätte");
    expect(normalizeForQuote("ﬁre")).toBe("fire");
  });
});
