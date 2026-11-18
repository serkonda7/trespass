// Free-text coordinate warning (DESIGN §3.4 rule 8). Flags decimal pairs,
// DMS, full plus codes and links to common map apps / geo: URIs. Deliberately
// conservative: plain years, prices and things like "Tor 3, 2. Stock" are not
// coordinates and must not trigger the warning.
import { type CoordinateSpan, findCoordinateSpans } from "./parse-coords";

export type CoordinateLike =
  | CoordinateSpan
  | {
      start: number;
      end: number;
      text: string;
      kind: "link";
    };

const MAP_HOST =
  /(?:^|[/@])(?:www\.)?(?:maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap\.org|osm\.org|osmand\.net|organicmaps\.app|maps\.apple\.com)(?:\/|\?|$|#)/i;
const URL = /\b(?:https?:\/\/|geo:)[^\s<>"'`]+/gi;

/** All coordinate-like spans in `text`, sorted by position and de-duplicated. */
export function findCoordinateLikeText(text: string): CoordinateLike[] {
  const out: CoordinateLike[] = findCoordinateSpans(text);
  for (const m of text.matchAll(URL)) {
    const value = m[0];
    if (value.toLowerCase().startsWith("geo:") || MAP_HOST.test(value)) {
      out.push({ start: m.index, end: m.index + value.length, text: value, kind: "link" });
    }
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out.filter((m, i) => i === 0 || m.start !== out[i - 1].start || m.end !== out[i - 1].end);
}

/** Convenience boolean for the editor UI. */
export const hasCoordinateLikeText = (text: string): boolean =>
  findCoordinateLikeText(text).length > 0;
