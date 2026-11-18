import { describe, expect, test } from "bun:test";
import { statusSchema } from "./inputs";
import { STATUSES, statusColor, statusLabel } from "./status";

describe("status presentation", () => {
  test("covers every status exactly once with a German label and a colour", () => {
    expect([...STATUSES].sort()).toEqual([...statusSchema.options].sort());
    for (const status of STATUSES) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(statusLabel(status)).not.toBe(status);
      expect(statusColor(status)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(STATUSES.map(statusColor)).size).toBe(STATUSES.length);
  });
});
