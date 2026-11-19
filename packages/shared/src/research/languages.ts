// Language hints for research queries (DESIGN §6.2). Countries come from
// reverse geocoding in German ("Belgien"); search areas store a language code.

export const RESEARCH_LANGS = [
  "de",
  "en",
  "fr",
  "nl",
  "it",
  "es",
  "pt",
  "pl",
  "cs",
  "sk",
  "sl",
  "hr",
  "hu",
  "ro",
  "bg",
  "el",
  "da",
  "sv",
  "nb",
  "fi",
  "et",
  "lv",
  "lt",
  "uk",
  "ru",
  "ja",
] as const;
export type ResearchLang = (typeof RESEARCH_LANGS)[number];

const BY_COUNTRY: Record<string, ResearchLang> = {
  deutschland: "de",
  österreich: "de",
  schweiz: "de",
  liechtenstein: "de",
  belgien: "nl",
  niederlande: "nl",
  luxemburg: "fr",
  frankreich: "fr",
  monaco: "fr",
  italien: "it",
  "san marino": "it",
  spanien: "es",
  portugal: "pt",
  polen: "pl",
  tschechien: "cs",
  slowakei: "sk",
  slowenien: "sl",
  kroatien: "hr",
  ungarn: "hu",
  rumänien: "ro",
  bulgarien: "bg",
  griechenland: "el",
  dänemark: "da",
  schweden: "sv",
  norwegen: "nb",
  finnland: "fi",
  estland: "et",
  lettland: "lv",
  litauen: "lt",
  ukraine: "uk",
  russland: "ru",
  japan: "ja",
  "vereinigtes königreich": "en",
  irland: "en",
  "vereinigte staaten": "en",
  "vereinigte staaten von amerika": "en",
  kanada: "en",
  australien: "en",
  neuseeland: "en",
};

/** The main local language for a (German) country name, or null when unknown. */
export function langForCountry(country: string | null | undefined): ResearchLang | null {
  if (!country) return null;
  return BY_COUNTRY[country.trim().toLowerCase()] ?? null;
}

export const isResearchLang = (v: string): v is ResearchLang =>
  (RESEARCH_LANGS as readonly string[]).includes(v);
