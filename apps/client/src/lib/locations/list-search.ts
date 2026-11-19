// Map filter state in the URL (like hausmeister's items/list-search.ts).
// The route's `validateSearch` is `parseLocationSearch`, every control calls
// `navigate({ search: (s) => patchLocationSearch(s, {...}) })`, and
// `toListInput` maps the URL state to the server function's input.
import {
  effectiveStatusSchema,
  type ListLocationsInput,
  MAP_LIMIT_MAX,
} from "@trespass/shared/locations/inputs";
import type { LocationStatus } from "@trespass/shared/locations/types";

export type LocationSearch = {
  q?: string;
  status?: LocationStatus[];
  category?: string[];
  tag?: string[];
  country?: string[];
};

const rawList = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((v): v is string => typeof v === "string");
};

const listOf = (value: unknown, max: number, valid?: (s: string) => boolean): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawList(value)) {
    const s = raw.trim().slice(0, 100);
    if (!s || (valid && !valid(s)) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length === max) break;
  }
  return out;
};

const statuses = effectiveStatusSchema.options as readonly string[];
const one = (value: unknown): string | undefined => {
  const list = rawList(value);
  const s = list[0]?.trim().slice(0, 200) ?? "";
  return s || undefined;
};

/** Never throws: bad or repeated URL values are simply dropped. */
export function parseLocationSearch(raw: Record<string, unknown>): LocationSearch {
  const out: LocationSearch = {};
  const q = one(raw.q);
  if (q) out.q = q;
  const status = listOf(raw.status, 7, (s) => statuses.includes(s)) as LocationStatus[];
  if (status.length) out.status = status;
  const category = listOf(raw.category, 50);
  if (category.length) out.category = category;
  const tag = listOf(raw.tag, 50);
  if (tag.length) out.tag = tag;
  const country = listOf(raw.country, 50);
  if (country.length) out.country = country;
  return out;
}

/** Removes empty/default values so the URL stays short and canonical. */
export function cleanLocationSearch(s: LocationSearch): LocationSearch {
  const out: LocationSearch = {};
  if (s.q?.trim()) out.q = s.q.trim().slice(0, 200);
  if (s.status?.length) out.status = [...new Set(s.status)];
  if (s.category?.length) out.category = [...new Set(s.category)];
  if (s.tag?.length) out.tag = [...new Set(s.tag)];
  if (s.country?.length) out.country = [...new Set(s.country)];
  return out;
}

/** `undefined` clears a key; arrays replace it. */
export function patchLocationSearch(
  s: LocationSearch,
  patch: Partial<LocationSearch>,
): LocationSearch {
  return cleanLocationSearch({ ...s, ...patch });
}

/** Map URL state to `listLocationsFn`. Filters stay in SQL on the server. */
export function toListInput(
  s: LocationSearch,
  opts: { bbox?: ListLocationsInput["bbox"]; limit?: number } = {},
): ListLocationsInput {
  const input: ListLocationsInput = { limit: opts.limit ?? MAP_LIMIT_MAX };
  if (s.q) input.q = s.q;
  if (s.status?.length) input.status = s.status;
  if (s.category?.length) input.categoryId = s.category;
  if (s.tag?.length) input.tag = s.tag;
  if (s.country?.length) input.country = s.country;
  if (opts.bbox) input.bbox = opts.bbox;
  return input;
}

/** Number of active filters (excluding the free-text search) for the UI. */
export function activeFilterCount(s: LocationSearch): number {
  return (
    (s.status?.length ?? 0) +
    (s.category?.length ?? 0) +
    (s.tag?.length ?? 0) +
    (s.country?.length ?? 0)
  );
}
