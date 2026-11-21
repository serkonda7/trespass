// Deletes blobs no photo row references (blobs are deduped). Check and unlink
// run synchronously in one tick, as does upload's move + insert, so they can't
// interleave. Triggered by "photos.gc" on delete and nightly "photos.sweep";
// never inline in a request.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { photos } from "../db/schema";
import { enqueueJob } from "../jobs/queue";
import { GC_JOB } from "./kinds";
import { isSha256, type PhotoStore } from "./storage";

export { GC_JOB, SWEEP_JOB } from "./kinds";

export function isBlobReferenced(db: DbOrTx, sha256: string): boolean {
  return !!db
    .select({ id: photos.id })
    .from(photos)
    .where(eq(photos.sha256, sha256))
    .limit(1)
    .get();
}

/** Deletes a blob and its derivatives when no row references it. */
export function collectBlobIfUnreferenced(db: DbOrTx, store: PhotoStore, sha256: string): boolean {
  if (isBlobReferenced(db, sha256)) return false;
  store.removeSync(sha256);
  return true;
}

/** Call inside the transaction that deletes photo rows. */
export function enqueueBlobGc(db: DbOrTx, sha256s: Iterable<string>) {
  for (const sha256 of new Set(sha256s)) enqueueJob(db, GC_JOB, { sha256 });
}

function listFiles(dir: string, depth: number): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  if (depth === 0) return names.map((n) => join(dir, n));
  return names
    .filter((n) => /^[0-9a-f]{2}$/.test(n))
    .flatMap((n) => listFiles(join(dir, n), depth - 1));
}

function olderThan(path: string, cutoff: number): boolean {
  try {
    return statSync(path).mtimeMs < cutoff;
  } catch {
    return false;
  }
}

/** Removes unreferenced blobs/derivatives and stale temp files (job only). */
export function sweepOrphanBlobs(
  db: DbOrTx,
  store: PhotoStore,
  opts: { graceMs?: number; now?: number } = {},
): { blobs: number; derived: number; tmp: number } {
  const cutoff = (opts.now ?? Date.now()) - (opts.graceMs ?? 3_600_000);
  const referenced = new Set(
    db
      .selectDistinct({ sha256: photos.sha256 })
      .from(photos)
      .all()
      .map((r) => r.sha256),
  );
  const out = { blobs: 0, derived: 0, tmp: 0 };
  for (const path of listFiles(store.root, 2)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (isSha256(name) && !referenced.has(name) && olderThan(path, cutoff)) {
      rmSync(path, { force: true });
      out.blobs++;
    }
  }
  try {
    for (const dir of readdirSync(join(store.root, "derived"))) {
      if (!isSha256(dir) || referenced.has(dir)) continue;
      const path = join(store.root, "derived", dir);
      if (olderThan(path, cutoff)) {
        rmSync(path, { recursive: true, force: true });
        out.derived++;
      }
    }
  } catch {
    // no derived directory yet
  }
  for (const path of listFiles(store.tmpDir, 0)) {
    if (olderThan(path, cutoff)) {
      rmSync(path, { force: true });
      out.tmp++;
    }
  }
  return out;
}
