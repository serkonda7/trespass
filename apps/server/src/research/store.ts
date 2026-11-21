// Writes findings to `candidates` with DESIGN §6.2 dedupe: same source record,
// ≤ 200 m from a location or earlier candidate (rejected too), or a similar
// name ≤ 5 km → evidence on the existing entry. Rejected stays rejected.
// Compares exact coordinates: fine only because research is admin-only.
import { haversineMeters } from "@trespass/shared/geo/distance";
import type { Point } from "@trespass/shared/geo/types";
import { similarNames } from "@trespass/shared/locations/names";
import { normalizeSearchText } from "@trespass/shared/normalize";
import { normalizeForQuote } from "@trespass/shared/research/quote";
import type {
  Evidence,
  FactPayload,
  NewLocationPayload,
  StatusChangePayload,
} from "@trespass/shared/research/types";
import { and, between, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { type CandidateRow, candidates, locations } from "../db/schema";

export const SAME_PLACE_M = 200;
export const SIMILAR_NAME_M = 5_000;

const evidenceKey = (e: Evidence) => `${e.url}\u0000${normalizeForQuote(e.quote)}`;

export function mergeEvidence(a: readonly Evidence[], b: readonly Evidence[]): Evidence[] {
  const seen = new Set(a.map(evidenceKey));
  const out = [...a];
  for (const e of b) {
    if (seen.has(evidenceKey(e))) continue;
    seen.add(evidenceKey(e));
    out.push(e);
  }
  return out;
}

function boxAround(p: Point, meters: number) {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLon: p.lon - dLon, maxLon: p.lon + dLon };
}

function appendEvidence(
  db: DbOrTx,
  row: CandidateRow,
  evidence: readonly Evidence[],
  confidence: number,
) {
  const merged = mergeEvidence(row.evidence ?? [], evidence);
  const changed = merged.length !== (row.evidence ?? []).length || confidence > row.confidence;
  if (!changed) return;
  db.update(candidates)
    .set({
      evidence: merged,
      confidence: Math.max(row.confidence, confidence),
      updatedAt: new Date(),
    })
    .where(eq(candidates.id, row.id))
    .run();
}

export type NewPlace = {
  runId: string | null;
  areaId: string | null;
  name: string | null;
  point: Point;
  sourceKey: string;
  payload: NewLocationPayload;
  evidence: Evidence[];
  confidence: number;
};

export type AddResult =
  | { result: "created"; id: string }
  | { result: "duplicate"; id: string }
  | { result: "known"; locationId: string };

/** The known location this place most likely is, if any. */
export function findKnownLocation(db: DbOrTx, name: string | null, point: Point): string | null {
  const box = boxAround(point, SIMILAR_NAME_M);
  const rows = db
    .select({ id: locations.id, name: locations.name, lat: locations.lat, lon: locations.lon })
    .from(locations)
    .where(
      and(
        between(locations.lat, box.minLat, box.maxLat),
        between(locations.lon, box.minLon, box.maxLon),
      ),
    )
    .all();
  let best: { id: string; d: number } | null = null;
  for (const r of rows) {
    const d = haversineMeters(point, r);
    if (d <= SAME_PLACE_M || (name && similarNames(name, r.name))) {
      if (!best || d < best.d) best = { id: r.id, d };
    }
  }
  return best?.id ?? null;
}

function findCandidate(
  db: DbOrTx,
  place: Pick<NewPlace, "name" | "point" | "sourceKey">,
): CandidateRow | null {
  const bySource = db
    .select()
    .from(candidates)
    .where(eq(candidates.sourceKey, place.sourceKey))
    .get();
  if (bySource) return bySource;
  const box = boxAround(place.point, SIMILAR_NAME_M);
  const rows = db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.kind, "new_location"),
        between(candidates.lat, box.minLat, box.maxLat),
        between(candidates.lon, box.minLon, box.maxLon),
      ),
    )
    .all();
  let best: { row: CandidateRow; d: number } | null = null;
  for (const r of rows) {
    if (r.lat === null || r.lon === null) continue;
    const d = haversineMeters(place.point, { lat: r.lat, lon: r.lon });
    if (d <= SAME_PLACE_M || (place.name && r.name && similarNames(place.name, r.name))) {
      if (!best || d < best.d) best = { row: r, d };
    }
  }
  return best?.row ?? null;
}

export function addNewPlace(db: DbOrTx, place: NewPlace): AddResult {
  const existing = findCandidate(db, place);
  if (existing) {
    appendEvidence(db, existing, place.evidence, place.confidence);
    return { result: "duplicate", id: existing.id };
  }
  const known = findKnownLocation(db, place.name, place.point);
  if (known) return { result: "known", locationId: known };
  const id = db
    .insert(candidates)
    .values({
      runId: place.runId,
      areaId: place.areaId,
      kind: "new_location",
      lat: place.point.lat,
      lon: place.point.lon,
      name: place.name,
      nameSort: place.name ? normalizeSearchText(place.name) : null,
      sourceKey: place.sourceKey,
      payload: place.payload,
      evidence: place.evidence,
      confidence: place.confidence,
    })
    .returning({ id: candidates.id })
    .get().id;
  return { result: "created", id };
}

export type LocationFinding =
  | { kind: "fact"; payload: FactPayload }
  | { kind: "status_change"; payload: StatusChangePayload };

/**
 * A fact or status change about a known location. Same source record, the
 * same dated fact, or the same suggested status (still in the inbox) only
 * adds evidence. A rejected identical finding is not suggested again.
 */
export function addLocationFinding(
  db: DbOrTx,
  o: {
    runId: string | null;
    locationId: string;
    sourceKey: string;
    finding: LocationFinding;
    evidence: Evidence[];
    confidence: number;
  },
): { result: "created" | "duplicate"; id: string } {
  const rows = db
    .select()
    .from(candidates)
    .where(and(eq(candidates.locationId, o.locationId), eq(candidates.kind, o.finding.kind)))
    .all();
  const same = rows.find((r) => {
    if (r.sourceKey === o.sourceKey) return true;
    if (o.finding.kind === "fact") {
      const p = r.payload as FactPayload;
      const q = o.finding.payload;
      return (
        p.dateFrom === q.dateFrom &&
        p.datePrecision === q.datePrecision &&
        (normalizeForQuote(p.text) === normalizeForQuote(q.text) ||
          (r.evidence ?? []).some((e) => o.evidence.some((n) => evidenceKey(e) === evidenceKey(n))))
      );
    }
    const p = r.payload as StatusChangePayload;
    return (
      p.status === o.finding.payload.status && (r.status === "inbox" || r.status === "rejected")
    );
  });
  if (same) {
    appendEvidence(db, same, o.evidence, o.confidence);
    return { result: "duplicate", id: same.id };
  }
  const id = db
    .insert(candidates)
    .values({
      runId: o.runId,
      kind: o.finding.kind,
      locationId: o.locationId,
      sourceKey: o.sourceKey,
      payload: o.finding.payload,
      evidence: o.evidence,
      confidence: o.confidence,
    })
    .returning({ id: candidates.id })
    .get().id;
  return { result: "created", id };
}
