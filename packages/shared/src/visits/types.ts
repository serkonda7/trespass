// Output shapes of the visit/journal server functions. No server-only imports.
import type { SerializedHistory } from "../history/types";
import type { ConditionsInput, VisitPersonInput } from "./inputs";

export type VisitAccess = "open" | "difficult" | "sealed";
export type VisitCondition = "good" | "fair" | "poor" | "collapsing";
export type VisitConditions = {
  access?: VisitAccess;
  securitySeen?: boolean;
  condition?: VisitCondition;
  hazards?: string[];
};
export type { ConditionsInput, VisitPersonInput };

export type SerializedVisitPerson = {
  userId: string | null;
  name: string | null;
  displayName: string;
};

/** The location is null when the author no longer has permission to see it. */
export type VisitLocationRef = { id: string; name: string; country: string | null };

export type VisitPermissions = { canEdit: boolean; canDelete: boolean };

export type SerializedVisit = {
  id: string;
  locationId: string;
  location: VisitLocationRef | null;
  authorId: string;
  authorName: string;
  visitedOn: string;
  conditions: VisitConditions;
  /** Sanitized HTML from the server; safe for innerHTML. */
  journalHtml: string;
  /** Only present when the caller may edit the visit. */
  journalMd?: string;
  /** First 200 characters of the plain text, for the feed. */
  excerpt: string;
  people: SerializedVisitPerson[];
  permissions: VisitPermissions;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type FeedPage = { rows: SerializedVisit[]; nextCursor: string | null };

export type TimelineVisitEntry = { kind: "visit"; date: string; visit: SerializedVisit };
export type TimelineStatusEntry = {
  kind: "status";
  date: string;
  from: string | null;
  to: string | null;
};
/** An approved history entry (drafts too for editors); `date` is its ISO prefix. */
export type TimelineHistoryEntry = { kind: "history"; date: string; history: SerializedHistory };
export type TimelineEntry = TimelineVisitEntry | TimelineStatusEntry | TimelineHistoryEntry;

export type YearReview = {
  year: number;
  visits: number;
  locations: number;
  countries: number;
  /** January … December, index 0 … 11. */
  months: number[];
};
