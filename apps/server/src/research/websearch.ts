// `search.web` (DESIGN §6.3): Wikipedia first (in the local language, German
// and English), then SearXNG when configured. Only the place's name, its
// category word and its country/region are sent, never coordinates.
import { similarNames } from "@trespass/shared/locations/names";
import type { PoliteFetcher } from "./http";

export type SearchHit = { url: string; title: string | null };

export async function wikipediaHits(
  fetcher: PoliteFetcher,
  name: string,
  langs: readonly string[],
): Promise<SearchHit[]> {
  const out: SearchHit[] = [];
  for (const lang of [...new Set(langs)]) {
    const api = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(name)}`;
    let body: string;
    try {
      body = await fetcher.api(api);
    } catch {
      continue;
    }
    const results =
      (JSON.parse(body) as { query?: { search?: { title: string }[] } }).query?.search ?? [];
    const hit = results.find((r) => similarNames(name, r.title));
    if (hit) {
      out.push({
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
        title: hit.title,
      });
    }
  }
  return out;
}

export async function searxngHits(
  fetcher: PoliteFetcher,
  baseUrl: string,
  query: string,
  opts: { lang?: string; timeRange?: "day" | "week" | "month" | "year"; limit?: number } = {},
): Promise<SearchHit[]> {
  const u = new URL("search", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  if (opts.lang) u.searchParams.set("language", opts.lang);
  if (opts.timeRange) u.searchParams.set("time_range", opts.timeRange);
  const body = await fetcher.api(u.toString());
  const results =
    (JSON.parse(body) as { results?: { url?: string; title?: string }[] }).results ?? [];
  return results
    .filter((r): r is { url: string; title?: string } => typeof r.url === "string")
    .slice(0, opts.limit ?? 5)
    .map((r) => ({ url: r.url, title: r.title ?? null }));
}

/** German query templates per category; the LLM translates them for other languages. */
const CATEGORY_WORDS: Record<string, string> = {
  industry: "Fabrik stillgelegt",
  sanatorium: "Heilstätte Krankenhaus",
  military: "Kaserne Bunker",
  villa: "Villa verlassen",
  hotel: "Hotel geschlossen",
  railway: "Bahnhof stillgelegt",
  church: "Kirche Kloster",
  leisure: "Freizeitpark geschlossen",
  agriculture: "Gutshof",
  other: "verlassen",
};

export function enrichQueries(name: string, categoryKey: string, place: string | null): string[] {
  const where = place ? ` ${place}` : "";
  return [
    `"${name}"${where} Geschichte`,
    `"${name}" ${CATEGORY_WORDS[categoryKey] ?? "verlassen"}`,
  ];
}

export const WATCH_TERMS_DE = "Abriss OR Abbruch OR Brand OR Investor OR Umbau OR Sanierung";

export function watchQuery(name: string, place: string | null): string {
  return `"${name}"${place ? ` ${place}` : ""} ${WATCH_TERMS_DE}`;
}
