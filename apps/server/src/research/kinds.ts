// Research job kinds (DESIGN §6.3). Handlers live in ./jobs, which is
// worker-only; web-side modules import the kind constants from here instead.
export const OVERPASS_JOB = "scan.overpass";
export const WIKIDATA_JOB = "scan.wikidata";
export const ENRICH_JOB = "research.enrich";
export const WATCH_JOB = "research.watch";
