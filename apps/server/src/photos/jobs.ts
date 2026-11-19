// Job handlers of the photo feature (registered by src/server/jobs/handlers.ts).
// `photos.process` is idempotent: a crash re-runs EXIF extraction and rebuilds
// all derivatives from the content-addressed original.

import { PHOTO_SIZES } from "@trespass/shared/photos/types";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { locations, photos } from "../db/schema";
import { nextDailyInBerlin } from "../jobs/schedule";
import { addJobHandler, type JobRegistry } from "../jobs/worker";
import { collectBlobIfUnreferenced, sweepOrphanBlobs } from "./gc";
import { GC_JOB, PROCESS_JOB, SWEEP_JOB } from "./kinds";
import { suggestPhotoMatches } from "./match";
import { extractExif, makeDerivatives, resolveTakenAt } from "./process";
import type { PhotoStore } from "./storage";

export { PROCESS_JOB } from "./kinds";

const photoPayload = z.object({ photoId: z.string().min(1) });
const shaPayload = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) });

export function addPhotoJobs(registry: JobRegistry, store: () => PhotoStore) {
  addJobHandler(
    registry,
    PROCESS_JOB,
    async (payload, { db, signal }) => {
      const { photoId } = photoPayload.parse(payload);
      const photo = db.select().from(photos).where(eq(photos.id, photoId)).get();
      if (!photo) return;
      const s = store();
      const ready =
        photo.status === "ready" && PHOTO_SIZES.every((size) => s.hasDerived(photo.sha256, size));
      if (ready) return;
      if (!s.hasBlob(photo.sha256)) {
        console.error(`[photos] original missing for ${photoId}`);
        db.update(photos).set({ status: "failed" }).where(eq(photos.id, photoId)).run();
        return;
      }

      try {
        const bytes = await Bun.file(s.blobPath(photo.sha256)).bytes();
        // EXIF is read before sharp touches the image; nothing is stored in the
        // original's place, so GPS can never leak through a derivative.
        const ex = await extractExif(bytes);
        const { width, height } = await makeDerivatives(bytes, s, photo.sha256, signal);
        if (signal?.aborted) return; // job will be retried after lease release
        const tz = photo.locationId
          ? db
              .select({ tz: locations.tz })
              .from(locations)
              .where(eq(locations.id, photo.locationId))
              .get()?.tz
          : null;
        const takenAt = resolveTakenAt(ex, tz);
        db.update(photos)
          .set({
            exif: ex.exif,
            gpsLat: ex.gpsLat,
            gpsLon: ex.gpsLon,
            takenAt,
            width,
            height,
            status: "ready",
          })
          .where(eq(photos.id, photoId))
          .run();
        // Suggestions use the uploader's visible coordinates (match.ts).
        suggestPhotoMatches(
          db,
          photoId,
          ex.gpsLat !== null && ex.gpsLon !== null ? { lat: ex.gpsLat, lon: ex.gpsLon } : null,
          takenAt,
          ex.takenLocal,
          ex.offset,
          signal,
        );
      } catch (err) {
        console.error(`[photos] processing ${photoId} failed`, err);
        db.update(photos).set({ status: "failed" }).where(eq(photos.id, photoId)).run();
      }
    },
    { maxAttempts: 3, backoffBaseMs: 10_000, timeoutMs: 120_000 },
  );

  addJobHandler(registry, GC_JOB, (payload, { db }) => {
    collectBlobIfUnreferenced(db, store(), shaPayload.parse(payload).sha256);
  });

  addJobHandler(
    registry,
    SWEEP_JOB,
    (_payload, { db }) => {
      const r = sweepOrphanBlobs(db, store());
      if (r.blobs || r.derived || r.tmp) console.log("[photos] sweep removed", r);
    },
    { recurring: { next: (now) => nextDailyInBerlin(now, 3, 15) } },
  );
}
