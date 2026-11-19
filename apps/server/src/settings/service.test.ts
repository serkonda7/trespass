import { describe, expect, test } from "bun:test";
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { eq } from "drizzle-orm";
import { HttpError } from "../auth/context";
import type { AppDb } from "../db/client";
import { events, settings } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { getSettings, type SettingsInput, updateSettings } from "./service";

const DEFAULTS: SettingsInput = {
  instanceName: "Trespass",
  researchBudgetCents: 0,
  tileBudgetMb: 10240,
  defaultFuzzM: 1500,
};

const ctxOf = (role: AuthCtx["role"]): AuthCtx => ({
  userId: `actor-${role}`,
  role,
  groupIds: new Set(),
});

function expectError(fn: () => unknown, status: HttpError["status"], message: string) {
  try {
    fn();
    throw new Error("expected an HttpError");
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).message).toBe(message);
  }
}

function settingsEvents(db: AppDb) {
  return db.select().from(events).all();
}

describe("settings", () => {
  test("getSettings returns the defaults on a fresh database", () => {
    const db = createTestDb();
    expect(getSettings(db)).toEqual(DEFAULTS);
  });

  test("an admin can update the settings; the name is trimmed", () => {
    const db = createTestDb();
    const result = updateSettings(db, ctxOf("admin"), {
      ...DEFAULTS,
      instanceName: "  Mein Trespass  ",
      researchBudgetCents: 500,
      tileBudgetMb: 2048,
      defaultFuzzM: 800,
    });
    expect(result).toEqual({
      ...DEFAULTS,
      instanceName: "Mein Trespass",
      researchBudgetCents: 500,
      tileBudgetMb: 2048,
      defaultFuzzM: 800,
    });
    expect(getSettings(db)).toEqual(result);
    const row = db.select().from(settings).where(eq(settings.id, 1)).get();
    expect(row?.instanceName).toBe("Mein Trespass");
    expect(row?.researchBudgetCents).toBe(500);
    expect(row?.tileBudgetMb).toBe(2048);
    expect(row?.defaultFuzzM).toBe(800);
  });

  test("members and guests get 403 and nothing changes", () => {
    const db = createTestDb();
    for (const role of ["member", "guest"] as const) {
      expectError(
        () => updateSettings(db, ctxOf(role), { ...DEFAULTS, instanceName: "Hack" }),
        403,
        "Forbidden",
      );
    }
    expect(getSettings(db)).toEqual(DEFAULTS);
    expect(settingsEvents(db)).toHaveLength(0);
  });

  test("invalid input is refused with the matching error code", () => {
    const db = createTestDb();
    expectError(
      () => updateSettings(db, ctxOf("admin"), { ...DEFAULTS, instanceName: "   " }),
      422,
      "SETTINGS_NAME_INVALID",
    );
    expectError(
      () => updateSettings(db, ctxOf("admin"), { ...DEFAULTS, instanceName: "x".repeat(81) }),
      422,
      "SETTINGS_NAME_INVALID",
    );
    expectError(
      () => updateSettings(db, ctxOf("admin"), { ...DEFAULTS, researchBudgetCents: -1 }),
      422,
      "SETTINGS_BUDGET_INVALID",
    );
    expectError(
      () => updateSettings(db, ctxOf("admin"), { ...DEFAULTS, tileBudgetMb: 0 }),
      422,
      "SETTINGS_TILE_BUDGET_INVALID",
    );
    expectError(
      () => updateSettings(db, ctxOf("admin"), { ...DEFAULTS, defaultFuzzM: -1 }),
      422,
      "SETTINGS_FUZZ_INVALID",
    );
    expect(getSettings(db)).toEqual(DEFAULTS);
    expect(settingsEvents(db)).toHaveLength(0);
  });

  test("one event per change with a diff of only the changed fields", () => {
    const db = createTestDb();
    updateSettings(db, ctxOf("admin"), { ...DEFAULTS, instanceName: "Mein Trespass" });
    const first = settingsEvents(db);
    expect(first).toHaveLength(1);
    expect(first[0]!.action).toBe("settings.updated");
    expect(first[0]!.actorId).toBe("actor-admin");
    expect(first[0]!.diff).toEqual({
      instanceName: { from: "Trespass", to: "Mein Trespass" },
    });

    // Identical values are a no-op: no second event.
    updateSettings(db, ctxOf("admin"), { ...DEFAULTS, instanceName: "Mein Trespass" });
    expect(settingsEvents(db)).toHaveLength(1);

    // Changing just one field logs just that field.
    updateSettings(db, ctxOf("admin"), {
      ...DEFAULTS,
      instanceName: "Mein Trespass",
      tileBudgetMb: 4096,
    });
    const second = settingsEvents(db);
    expect(second).toHaveLength(2);
    expect(second[1]!.diff).toEqual({
      tileBudgetMb: { from: 10240, to: 4096 },
    });
  });
});
