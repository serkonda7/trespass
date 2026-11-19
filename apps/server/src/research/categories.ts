// Guesses one of the seeded category keys (DESIGN §2) from OSM tags or
// Wikidata type labels. Only a suggestion: the inbox lets the admin change it.

const RULES: [RegExp, string][] = [
  [/hospital|clinic|sanatori|asylum|psychiatr|infirmary|krankenhaus|heilst/, "sanatorium"],
  [
    /military|bunker|barrack|fort\b|fortress|kaserne|airfield|bomb.?shelter|missile|army/,
    "military",
  ],
  [/railway|station|train|tram|depot|bahn|locomotive|tunnel/, "railway"],
  [/hotel|guest_house|hostel|motel|restaurant|pub\b|bar\b|cafe|inn\b/, "hotel"],
  [/church|chapel|monastery|abbey|convent|cathedral|place_of_worship|kloster/, "church"],
  [
    /theme_park|amusement|cinema|theatre|theater|swimming|stadium|ski|zoo|attraction|casino|leisure/,
    "leisure",
  ],
  [/farm|barn|agricult|greenhouse|stable|mill\b/, "agriculture"],
  [
    /industr|factory|works|mine|mining|colliery|brewery|power.?(plant|station)|warehouse|brownfield|quarry|steel|plant\b|zeche|gasometer|silo/,
    "industry",
  ],
  [/house|villa|residential|manor|castle|palace|mansion|apartments|school|dormitory/, "villa"],
];

export function categoryKeyFor(texts: readonly string[]): string {
  const haystack = texts.join(" ").toLowerCase();
  for (const [re, key] of RULES) if (re.test(haystack)) return key;
  return "other";
}

/** The tag values that say what an OSM feature was (abandoned:*, disused:*, building, …). */
export function osmKindTexts(tags: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tags)) {
    if (/^(abandoned|disused|was|ruins):/.test(k)) out.push(k.replace(/^[a-z]+:/, ""), v);
    else if (
      /^(amenity|building|landuse|historic|military|railway|tourism|man_made|leisure|industrial|ruins)$/.test(
        k,
      )
    )
      out.push(k, v);
  }
  return out;
}
