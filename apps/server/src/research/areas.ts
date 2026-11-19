// Search areas (DESIGN §6.2): drawn polygons or circles around existing pins,
// each with a language hint. Admin only; the audit log records ids and names,
// never the geometry (a circle's centre is an exact location).

import { can } from "@trespass/shared/app-actions";
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import {
  circleRing,
  closeRing,
  isSimpleRing,
  type Ring,
  ringAreaKm2,
  vertexCount,
} from "@trespass/shared/geo/polygon";
import {
  AREA_MAX_KM2,
  AREA_MAX_VERTICES,
  type CreateAreaInput,
  createAreaInput,
  updateAreaInput,
} from "@trespass/shared/research/inputs";
import { isResearchLang } from "@trespass/shared/research/languages";
import type { SearchAreaDto } from "@trespass/shared/research/types";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { recordEvent } from "../audit";
import { canSeeExact, loadLocationForCtx } from "../authz";
import type { AppDb } from "../db/client";
import { researchRuns, type SearchAreaRow, searchAreas } from "../db/schema";
import { appForbidden, appInvalid, appNotFound, parseAppInput } from "../errors";

export function requireResearch(ctx: AuthCtx) {
  if (!can(ctx, "research")) throw appForbidden("RESEARCH_FORBIDDEN");
}

const notFound = () => appNotFound("AREA_NOT_FOUND");

function toDto(db: AppDb, row: SearchAreaRow): SearchAreaDto {
  const last = db
    .select({ kind: researchRuns.kind, status: researchRuns.status, at: researchRuns.createdAt })
    .from(researchRuns)
    .where(eq(researchRuns.areaId, row.id))
    .orderBy(desc(researchRuns.createdAt))
    .limit(1)
    .get();
  return {
    id: row.id,
    name: row.name,
    lang: isResearchLang(row.lang) ? row.lang : "de",
    geom: row.geom,
    areaKm2: Math.round(ringAreaKm2(row.geom.coordinates[0] as Ring) * 10) / 10,
    createdAt: row.createdAt.toISOString(),
    lastScan: last ? { kind: last.kind, status: last.status, at: last.at.toISOString() } : null,
  };
}

export function listAreas(db: AppDb, ctx: AuthCtx): SearchAreaDto[] {
  requireResearch(ctx);
  return db
    .select()
    .from(searchAreas)
    .orderBy(desc(searchAreas.createdAt))
    .all()
    .map((r) => toDto(db, r));
}

export function requireArea(db: AppDb, ctx: AuthCtx, id: string): SearchAreaRow {
  requireResearch(ctx);
  const row = db.select().from(searchAreas).where(eq(searchAreas.id, id)).get();
  if (!row) throw notFound();
  return row;
}

function ringFor(db: AppDb, ctx: AuthCtx, shape: z.output<typeof createAreaInput>["shape"]): Ring {
  if (shape.type === "polygon") return closeRing(shape.ring);
  const found = loadLocationForCtx(db, ctx, shape.locationId);
  if (!found) throw appNotFound("LOCATION_NOT_FOUND");
  if (!canSeeExact(found.level)) throw appForbidden("LOCATION_FORBIDDEN");
  return circleRing({ lat: found.location.lat, lon: found.location.lon }, shape.radiusKm);
}

export function createArea(db: AppDb, ctx: AuthCtx, raw: CreateAreaInput): SearchAreaDto {
  requireResearch(ctx);
  const input = parseAppInput(createAreaInput, raw);
  const ring = ringFor(db, ctx, input.shape);
  const n = vertexCount(ring);
  if (n < 3 || n > AREA_MAX_VERTICES || !isSimpleRing(ring)) throw appInvalid("AREA_SHAPE_INVALID");
  const km2 = ringAreaKm2(ring);
  if (km2 <= 0.01) throw appInvalid("AREA_SHAPE_INVALID");
  if (km2 > AREA_MAX_KM2) throw appInvalid("AREA_TOO_LARGE");
  return db.transaction((tx) => {
    const row = tx
      .insert(searchAreas)
      .values({
        name: input.name,
        lang: input.lang,
        geom: { type: "Polygon", coordinates: [ring] },
        createdBy: ctx.userId,
      })
      .returning()
      .get();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "research.area_created",
      diff: { areaId: row.id, name: row.name },
    });
    return toDto(tx as unknown as AppDb, row);
  });
}

export function updateArea(
  db: AppDb,
  ctx: AuthCtx,
  raw: z.input<typeof updateAreaInput>,
): SearchAreaDto {
  const input = parseAppInput(updateAreaInput, raw);
  requireArea(db, ctx, input.id);
  const row = db
    .update(searchAreas)
    .set({ name: input.name, lang: input.lang, updatedAt: new Date() })
    .where(eq(searchAreas.id, input.id))
    .returning()
    .get();
  if (!row) throw notFound();
  recordEvent(db, {
    actorId: ctx.userId,
    entityId: row.id,
    action: "research.area_updated",
    diff: { areaId: row.id, name: row.name, lang: row.lang },
  });
  return toDto(db, row);
}

/** Candidates keep their area link as null; decided ones stay remembered. */
export function deleteArea(db: AppDb, ctx: AuthCtx, id: string): void {
  const row = requireArea(db, ctx, id);
  db.transaction((tx) => {
    tx.delete(searchAreas).where(eq(searchAreas.id, row.id)).run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "research.area_deleted",
      diff: { areaId: row.id },
    });
  });
}
