// What the export page needs: the caller's scope with a size estimate, the
// running export's progress, and a reservation for the download (registry.ts).
// Guests get 404 like every other export path (DESIGN §3.5).

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import type { ExportInfo } from "@trespass/shared/export/types";
import { count, sql } from "drizzle-orm";
import { HttpError } from "../auth/context";
import {
  exportScope,
  visibleLocationsWhere,
  visiblePhotosWhere,
  visibleVisitsWhere,
} from "../authz";
import type { AppDb } from "../db/client";
import { locations, photos, visits } from "../db/schema";
import type { ExportRegistry } from "./registry";

/** Throws a coded error the page maps to German (EXPORT_BUSY / EXPORT_LIMIT). */
export class ExportError extends HttpError {
  constructor(code: "EXPORT_BUSY" | "EXPORT_LIMIT") {
    super(429, code);
    this.name = "ExportError";
  }
}

function requireExportScope(ctx: AuthCtx) {
  const scope = exportScope(ctx);
  if (scope === "none") throw new HttpError(404, "NOT_FOUND");
  return scope;
}

export function getExportInfo(db: AppDb, ctx: AuthCtx, registry: ExportRegistry): ExportInfo {
  const scope = requireExportScope(ctx);
  const locationCount =
    db.select({ n: count() }).from(locations).where(visibleLocationsWhere(ctx, locations)).get()
      ?.n ?? 0;
  const visitCount =
    db.select({ n: count() }).from(visits).where(visibleVisitsWhere(ctx, visits)).get()?.n ?? 0;
  // An estimate: a member gets derivatives for other people's photos, so the
  // archived bytes are often smaller than the sum of the original bytes.
  const photoFiles = db
    .select({ n: count(), bytes: sql<number>`coalesce(sum(${photos.bytes}), 0)` })
    .from(photos)
    .where(visiblePhotosWhere(ctx, photos))
    .get();
  const status = registry.status(ctx.userId);
  return {
    scope,
    estimate: {
      locations: locationCount,
      visits: visitCount,
      photos: photoFiles?.n ?? 0,
      fileBytes: Number(photoFiles?.bytes ?? 0),
    },
    active: status.active,
    last: status.last,
  };
}

export function reserveExport(ctx: AuthCtx, registry: ExportRegistry): { ticket: string } {
  requireExportScope(ctx);
  const r = registry.reserve(ctx.userId);
  if (typeof r === "string") throw new ExportError(r);
  return r;
}
