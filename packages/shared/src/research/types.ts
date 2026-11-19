// DTOs of the research area (DESIGN §6). Admin only: these carry exact
// coordinates of candidates and, for merge targets, of known locations.

import type { GeoJsonPolygon, Point } from "../geo/types";
import type { HistoryPrecision } from "../history/inputs";
import type { ResearchLang } from "./languages";

export const RESEARCH_RUN_KINDS = ["scan.overpass", "scan.wikidata", "enrich", "watch"] as const;
export type ResearchRunKind = (typeof RESEARCH_RUN_KINDS)[number];
/** `budget`: stopped at the monthly LLM limit; `skipped`: disabled or not configured. */
export const RESEARCH_RUN_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
  "budget",
  "skipped",
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];
export const CANDIDATE_KINDS = ["new_location", "fact", "status_change"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
export const CANDIDATE_STATUSES = ["inbox", "accepted", "merged", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
/** Terminal statuses a status_change candidate may suggest. */
export const SUGGESTED_STATUSES = ["sealed", "redeveloped", "demolished"] as const;
export type SuggestedStatus = (typeof SUGGESTED_STATUSES)[number];

export type EvidenceSource = "osm" | "wikidata" | "web";

/** One piece of evidence. `verified`: the quote was found in the fetched text (or is structured data). */
export type Evidence = {
  url: string;
  title?: string | null;
  quote: string;
  verified: boolean;
  source: EvidenceSource;
  /** Wayback copy used when the live page could not be fetched. */
  archivedUrl?: string | null;
};

/**
 * A dated fact, as it becomes a history entry when accepted. `template` marks
 * a fact whose German text is rendered from the catalog (see ./text.ts): the
 * worker cannot load Paraglide, so it stores the marker and an empty text.
 */
export type FactPayload = {
  datePrecision: HistoryPrecision;
  dateFrom: string;
  dateTo?: string | null;
  text: string;
  template?: "closed";
};

export type NewLocationPayload = {
  categoryKey: string;
  description?: string | null;
  /** OSM tags or Wikidata types that matched (for display only). */
  tags?: Record<string, string>;
  osm?: { type: "node" | "way" | "relation"; id: number };
  wikidata?: { id: string; types?: string[] };
  /** Facts that become approved history entries on accept/merge. */
  facts?: FactPayload[];
};

export type StatusChangePayload = { status: SuggestedStatus; reason: string };

export type CandidatePayload = NewLocationPayload | FactPayload | StatusChangePayload;

export type SearchAreaDto = {
  id: string;
  name: string;
  lang: ResearchLang;
  geom: GeoJsonPolygon;
  areaKm2: number;
  createdAt: string;
  lastScan: { kind: ResearchRunKind; status: ResearchRunStatus; at: string } | null;
};

export type CandidateLocationRef = {
  id: string;
  name: string;
  point: Point;
  distanceM: number | null;
};

export type CandidateDto = {
  id: string;
  kind: CandidateKind;
  status: CandidateStatus;
  /** null for unnamed OSM features; the UI shows the matching tag instead. */
  name: string | null;
  point: Point | null;
  payload: CandidatePayload;
  evidence: Evidence[];
  confidence: number;
  /** The location a fact/status change is about. */
  location: CandidateLocationRef | null;
  /** The location created or merged into when decided. */
  resultLocation: { id: string; name: string } | null;
  /** Known locations close by (merge targets), new_location only. */
  nearby: CandidateLocationRef[];
  area: { id: string; name: string } | null;
  run: { id: string; kind: ResearchRunKind } | null;
  createdAt: string;
  decidedAt: string | null;
};

export type CandidateList = {
  items: CandidateDto[];
  nextCursor: string | null;
  counts: Record<CandidateStatus, number>;
};

export type ResearchRunStats = {
  found?: number;
  created?: number;
  duplicates?: number;
  known?: number;
  pages?: number;
  facts?: number;
  /** Facts the server dropped (quote not found, bad date, off-topic page). */
  dropped?: number;
  /** Pages not fetched: robots.txt, blocklist, content type or size. */
  refused?: number;
  failedPages?: number;
  locations?: number;
  reason?: string;
};

export type ResearchRunDto = {
  id: string;
  kind: ResearchRunKind;
  status: ResearchRunStatus;
  area: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  stats: ResearchRunStats;
  summary: string | null;
  error: string | null;
  costCents: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ResearchBudget = {
  month: string;
  limitCents: number;
  spentCents: number;
  llmConfigured: boolean;
  webSearchConfigured: boolean;
  enabled: boolean;
};

export type ResearchOverview = { runs: ResearchRunDto[]; budget: ResearchBudget };
