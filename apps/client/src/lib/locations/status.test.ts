import { describe, expect, test } from "bun:test";
import { effectiveStatusSchema, statusSchema } from "@trespass/shared/locations/inputs";
import { EDITABLE_STATUSES, STATUSES, statusColor, statusLabel } from "./status";

describe("status presentation", () => {
  test("covers every status exactly once with a German label and a colour", () => {
    expect([...STATUSES].sort()).toEqual([...effectiveStatusSchema.options].sort());
    for (const status of STATUSES) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(statusLabel(status)).not.toBe(status);
      expect(statusColor(status)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(STATUSES.map(statusColor)).size).toBe(STATUSES.length);
  });

  test("`visited` is display/filter only and can never be written", () => {
    expect(STATUSES).toContain("visited");
    expect(EDITABLE_STATUSES).not.toContain("visited");
    expect([...EDITABLE_STATUSES].sort()).toEqual([...statusSchema.options].sort());
    expect(statusSchema.safeParse("visited").success).toBe(false);
  });
});
