// Output of the dashboard server function. Every count and row is computed
// with the same SQL visibility predicates as the pages it links to.
import type { LocationStatus } from "../locations/types";
import type { TripSummary } from "../trips/types";
import type { SerializedVisit, YearReview } from "../visits/types";

export type Dashboard = {
  /** Visible locations, all statuses. */
  locations: number;
  /** Visible locations per effective status (every status present, 0 if none). */
  statusCounts: Record<LocationStatus, number>;
  /** The caller's own photos that are attached to nothing yet. */
  unsortedPhotos: number;
  /** Open research candidates; present only for callers who may research. */
  researchInbox?: number;
  /** Visible visits of the current year. */
  year: YearReview;
  /** The newest visible visits. */
  recentVisits: SerializedVisit[];
  /** Planned and active trips the caller can see. */
  openTrips: TripSummary[];
};
