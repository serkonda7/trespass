// `scan.wikidata`: items in the area with a closure date (P576, P3999, P730).
// New → `new_location` (+ fact); known → `fact`. Sends only the bbox.

import { pointInRing, type Ring, ringBbox } from "@trespass/shared/geo/polygon";
import type { Point } from "@trespass/shared/geo/types";
import type { HistoryPrecision } from "@trespass/shared/history/inputs";
import type { Evidence, FactPayload } from "@trespass/shared/research/types";
import { categoryKeyFor } from "./categories";

const PROPS = ["P576", "P3999", "P730"] as const;

export function buildWikidataQuery(ring: Ring, lang: string): string {
  const b = ringBbox(ring);
  const unions = PROPS.map((p) => `{ ?item p:${p}/psv:${p} ?v . BIND("${p}" AS ?prop) }`).join(
    " UNION ",
  );
  const langs = [...new Set([lang, "de", "en"])].join(",");
  return `SELECT ?item ?itemLabel ?itemDescription ?coord ?typeEn ?end ?precision ?prop WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${b.minLon} ${b.minLat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${b.maxLon} ${b.maxLat})"^^geo:wktLiteral .
  }
  ${unions}
  ?v wikibase:timeValue ?end ; wikibase:timePrecision ?precision .
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeEn . FILTER(LANG(?typeEn) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langs}". }
}
LIMIT 2000`;
}

type Binding = Record<string, { value: string } | undefined>;

export type WikidataPlace = {
  sourceKey: string;
  qid: string;
  name: string;
  description: string | null;
  point: Point;
  types: string[];
  categoryKey: string;
  closed: FactPayload | null;
  evidence: Evidence;
};

/** Wikidata time + precision → a history date ('YYYY', 'YYYY-MM', 'YYYY-MM-DD'). */
export function wikidataDate(
  value: string,
  precision: number,
): { dateFrom: string; datePrecision: HistoryPrecision } | null {
  const match = /^[+]?(\d{1,4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = match[1]!.padStart(4, "0");
  if (year === "0000") return null;
  if (precision >= 11) return { dateFrom: `${year}-${match[2]}-${match[3]}`, datePrecision: "day" };
  if (precision === 10) return { dateFrom: `${year}-${match[2]}`, datePrecision: "month" };
  if (precision === 9) return { dateFrom: year, datePrecision: "year" };
  if (precision === 8) return { dateFrom: `${year.slice(0, 3)}0`, datePrecision: "decade" };
  return null;
}

const PROP_LABEL: Record<string, string> = {
  P576: "dissolved, abolished or demolished date",
  P3999: "date of official closure",
  P730: "service retirement",
};

export function parseWikidata(json: unknown, ring: Ring): WikidataPlace[] {
  const rows = ((json as { results?: { bindings?: Binding[] } })?.results?.bindings ??
    []) as Binding[];
  const byItem = new Map<string, WikidataPlace>();
  for (const r of rows) {
    const uri = r.item?.value ?? "";
    const qid = /\/(Q\d+)$/.exec(uri)?.[1];
    const coord = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(r.coord?.value ?? "");
    if (!qid || !coord) continue;
    const point = { lon: Number(coord[1]), lat: Number(coord[2]) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !pointInRing(point, ring))
      continue;
    const label = r.itemLabel?.value ?? qid;
    // The label service falls back to the bare QID when no label exists.
    const name = label === qid ? qid : label;
    let place = byItem.get(qid);
    if (!place) {
      place = {
        sourceKey: `wd:${qid}`,
        qid,
        name: name.slice(0, 200),
        description: r.itemDescription?.value ?? null,
        point,
        types: [],
        categoryKey: "other",
        closed: null,
        evidence: {
          url: `https://www.wikidata.org/wiki/${qid}`,
          title: name,
          quote: "",
          verified: true,
          source: "wikidata",
        },
      };
      byItem.set(qid, place);
    }
    const type = r.typeEn?.value;
    if (type && !place.types.includes(type)) place.types.push(type);
    const date = r.end?.value ? wikidataDate(r.end.value, Number(r.precision?.value ?? 0)) : null;
    if (date && (!place.closed || date.dateFrom < place.closed.dateFrom)) {
      // The German text is rendered when accepted (research/text.ts); the
      // worker has no message catalog.
      place.closed = { ...date, text: "", template: "closed" };
      place.evidence = {
        ...place.evidence,
        quote: `${PROP_LABEL[r.prop?.value ?? ""] ?? "end"}: ${date.dateFrom}`,
      };
    }
  }
  for (const p of byItem.values()) {
    p.categoryKey = categoryKeyFor([...p.types, p.description ?? ""]);
    if (!p.evidence.quote) p.evidence = { ...p.evidence, quote: p.description ?? p.qid };
  }
  return [...byItem.values()];
}
