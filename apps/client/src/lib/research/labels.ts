// German labels for research enums (strings live in de.json).
import { m } from "@trespass/shared/paraglide/messages";
import type { ResearchLang } from "@trespass/shared/research/languages";
import type {
  CandidateKind,
  EvidenceSource,
  ResearchRunKind,
  ResearchRunStatus,
} from "@trespass/shared/research/types";

const RUN_KIND: Record<ResearchRunKind, () => string> = {
  "scan.overpass": m.research_run_kind_overpass,
  "scan.wikidata": m.research_run_kind_wikidata,
  enrich: m.research_run_kind_enrich,
  watch: m.research_run_kind_watch,
};
export const runKindLabel = (k: ResearchRunKind) => RUN_KIND[k]();

const RUN_STATUS: Record<ResearchRunStatus, () => string> = {
  pending: m.research_run_status_pending,
  running: m.research_run_status_running,
  done: m.research_run_status_done,
  failed: m.research_run_status_failed,
  budget: m.research_run_status_budget,
  skipped: m.research_run_status_skipped,
};
export const runStatusLabel = (s: ResearchRunStatus) => RUN_STATUS[s]();

const REASON: Record<string, () => string> = {
  disabled: m.research_run_reason_disabled,
  no_llm: m.research_run_reason_no_llm,
  no_search: m.research_run_reason_no_search,
  area_missing: m.research_run_reason_area_missing,
  location_missing: m.research_run_reason_location_missing,
};
export const runReasonLabel = (r: string) => REASON[r]?.() ?? r;

const KIND: Record<CandidateKind, () => string> = {
  new_location: m.research_kind_new_location,
  fact: m.research_kind_fact,
  status_change: m.research_kind_status_change,
};
export const candidateKindLabel = (k: CandidateKind) => KIND[k]();

const SOURCE: Record<EvidenceSource, () => string> = {
  osm: m.research_source_osm,
  wikidata: m.research_source_wikidata,
  web: m.research_source_web,
};
export const evidenceSourceLabel = (s: EvidenceSource) => SOURCE[s]();

const LANG: Record<ResearchLang, () => string> = {
  de: m.research_lang_de,
  en: m.research_lang_en,
  fr: m.research_lang_fr,
  nl: m.research_lang_nl,
  it: m.research_lang_it,
  es: m.research_lang_es,
  pt: m.research_lang_pt,
  pl: m.research_lang_pl,
  cs: m.research_lang_cs,
  sk: m.research_lang_sk,
  sl: m.research_lang_sl,
  hr: m.research_lang_hr,
  hu: m.research_lang_hu,
  ro: m.research_lang_ro,
  bg: m.research_lang_bg,
  el: m.research_lang_el,
  da: m.research_lang_da,
  sv: m.research_lang_sv,
  nb: m.research_lang_nb,
  fi: m.research_lang_fi,
  et: m.research_lang_et,
  lv: m.research_lang_lv,
  lt: m.research_lang_lt,
  uk: m.research_lang_uk,
  ru: m.research_lang_ru,
  ja: m.research_lang_ja,
};
export const langLabel = (l: ResearchLang) => LANG[l]();
