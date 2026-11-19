// German text for research findings that the worker stores as markers
// (the worker runs outside Vite and has no Paraglide messages).
import { m } from "../paraglide/messages";
import type { CandidateDto, FactPayload } from "./types";

export function factText(f: FactPayload): string {
  if (f.text.trim()) return f.text;
  return f.template === "closed" ? m.research_fact_closed() : f.text;
}

/** Display name of a candidate: its name, the location it is about, or the matching OSM tag. */
export function candidateTitle(c: Pick<CandidateDto, "name" | "location" | "evidence">): string {
  return (
    c.name ?? c.location?.name ?? m.research_unnamed_place({ tag: c.evidence[0]?.quote ?? "?" })
  );
}
