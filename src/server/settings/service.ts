// Instance settings singleton (settings.id = 1). Any signed-in user may read
// it; only admins may change it. The locale is fixed (German-only app).
import { eq } from "drizzle-orm";
import { diffFields } from "../../lib/diff";
import { recordEvent } from "../audit";
import { HttpError, requireRole } from "../auth/context";
import type { AuthCtx } from "../authz/ctx";
import type { AppDb, DbOrTx } from "../db/client";
import { settings } from "../db/schema";

export const INSTANCE_NAME_MAX_LENGTH = 80;

export type Settings = {
  instanceName: string;
  researchBudgetCents: number;
  tileBudgetMb: number;
  defaultFuzzM: number;
};

export type SettingsInput = Settings;

/** The singleton always exists (a migration inserts id 1); fallbacks keep tests simple. */
function current(db: DbOrTx): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  return {
    instanceName: row?.instanceName ?? "Trespass",
    researchBudgetCents: row?.researchBudgetCents ?? 0,
    tileBudgetMb: row?.tileBudgetMb ?? 10240,
    defaultFuzzM: row?.defaultFuzzM ?? 1500,
  };
}

export function getSettings(db: AppDb): Settings {
  return current(db);
}

function cleanName(value: string): string {
  const v = value.trim();
  if (!v || v.length > INSTANCE_NAME_MAX_LENGTH) {
    throw new HttpError(422, "SETTINGS_NAME_INVALID");
  }
  return v;
}

function cleanNonNegativeInt(value: number, code: string, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min) throw new HttpError(422, code);
  return value;
}

export function updateSettings(db: AppDb, ctx: AuthCtx, input: SettingsInput): Settings {
  requireRole(ctx, "admin");
  const instanceName = cleanName(input.instanceName);
  const researchBudgetCents = cleanNonNegativeInt(
    input.researchBudgetCents,
    "SETTINGS_BUDGET_INVALID",
  );
  const tileBudgetMb = cleanNonNegativeInt(input.tileBudgetMb, "SETTINGS_TILE_BUDGET_INVALID", 1);
  const defaultFuzzM = cleanNonNegativeInt(input.defaultFuzzM, "SETTINGS_FUZZ_INVALID");

  return db.transaction((tx) => {
    const before = current(tx);
    const after: Settings = { instanceName, researchBudgetCents, tileBudgetMb, defaultFuzzM };
    const diff = diffFields(before, after);

    tx.update(settings).set(after).where(eq(settings.id, 1)).run();
    if (Object.keys(diff).length > 0) {
      recordEvent(tx, { actorId: ctx.userId, action: "settings.updated", diff });
    }
    return after;
  });
}
