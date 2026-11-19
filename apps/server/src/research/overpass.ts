// `scan.overpass` (DESIGN §6.3): abandoned, disused and ruined features from
// OpenStreetMap inside a search area become `new_location` candidates. The
// polygon goes to Overpass as a `poly:` filter; nothing else is sent.

import { pointInRing, type Ring } from "@trespass/shared/geo/polygon";
import type { Point } from "@trespass/shared/geo/types";
import type { Evidence } from "@trespass/shared/research/types";
import { categoryKeyFor, osmKindTexts } from "./categories";

export const OVERPASS_MAX_RESULTS = 1000;
/** New candidates per scan; the rest wait for the next run. */
export const SCAN_MAX_NEW = 200;

const FILTERS = [
  '[~"^abandoned:"~"."]',
  '[~"^disused:"~"."]',
  '["ruins"="yes"]',
  '["historic"="ruins"]',
  '["building"="ruins"]',
  '["railway"="abandoned"]',
  '["landuse"="brownfield"]',
];

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);

export function buildOverpassQuery(ring: Ring): string {
  // Overpass wants "lat lon lat lon …" without the closing point.
  const poly = ring
    .slice(0, -1)
    .map(([lon, lat]) => `${fmt(lat)} ${fmt(lon)}`)
    .join(" ");
  const parts = FILTERS.map((f) => `  nwr${f}(poly:"${poly}");`).join("\n");
  return `[out:json][timeout:120];\n(\n${parts}\n);\nout center tags ${OVERPASS_MAX_RESULTS};`;
}

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OsmPlace = {
  sourceKey: string;
  /** null when OSM has no name; the inbox shows the matching tag instead. */
  name: string | null;
  point: Point;
  categoryKey: string;
  tags: Record<string, string>;
  osm: { type: "node" | "way" | "relation"; id: number };
  evidence: Evidence;
  confidence: number;
};

const NAME_KEYS = [
  "name",
  "name:de",
  "old_name",
  "abandoned:name",
  "disused:name",
  "historic:name",
  "name:en",
];

/** Tags worth showing in the inbox (what made it match, plus names). */
function relevantTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (
      /^(abandoned|disused|ruins|was)(:|$)/.test(k) ||
      /^(name|old_name|historic|building|amenity|landuse|railway|military|start_date|end_date|wikidata|wikipedia)(:|$)/.test(
        k,
      )
    )
      out[k] = v;
  }
  return out;
}

function matchingTag(tags: Record<string, string>): string {
  for (const [k, v] of Object.entries(tags))
    if (/^(abandoned|disused):/.test(k)) return `${k}=${v}`;
  for (const k of ["ruins", "historic", "building", "railway", "landuse"]) {
    const v = tags[k];
    if (v && ["yes", "ruins", "abandoned", "brownfield"].includes(v)) return `${k}=${v}`;
  }
  return Object.entries(tags)[0]?.join("=") ?? "";
}

export function parseOverpass(json: unknown, ring: Ring): OsmPlace[] {
  const elements = ((json as { elements?: OverpassElement[] })?.elements ?? []).filter(
    (e) => e && (e.type === "node" || e.type === "way" || e.type === "relation"),
  );
  const out: OsmPlace[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const point = { lat, lon };
    if (!pointInRing(point, ring)) continue;
    const tags = e.tags ?? {};
    const named = NAME_KEYS.map((k) => tags[k]).find((v) => v?.trim());
    const tag = matchingTag(tags);
    // Unnamed abandoned tracks and brownfields are mostly noise (dozens of
    // way segments); keep only named ones.
    if (!named && (tags.railway === "abandoned" || tags.landuse === "brownfield")) continue;
    const name = named ? named.trim().slice(0, 200) : null;
    const url = `https://www.openstreetmap.org/${e.type}/${e.id}`;
    out.push({
      sourceKey: `osm:${e.type}/${e.id}`,
      name,
      point,
      categoryKey: categoryKeyFor(osmKindTexts(tags)),
      tags: relevantTags(tags),
      osm: { type: e.type, id: e.id },
      evidence: { url, title: named ?? null, quote: tag, verified: true, source: "osm" },
      confidence: named ? 0.6 : 0.35,
    });
  }
  return out;
}
