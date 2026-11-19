// Output shapes of the trip server functions. No server-only imports.
import type { SerializedLocation } from "../locations/types";
import type { TripStatus } from "./inputs";

export type SerializedTripPerson = {
  userId: string | null;
  name: string | null;
  displayName: string;
};

export type SerializedEmergencyContact =
  | { kind: "user"; userId: string; displayName: string }
  | { kind: "external"; name: string; email: string | null; ntfyTopic: string | null };

/** One stop. The location went through serializeLocation at the caller's level. */
export type SerializedTripStop = { sort: number; location: SerializedLocation };

export type SerializedChecklistItem = {
  id: string;
  label: string;
  packed: boolean;
  equipmentId: string | null;
  needsCharging: boolean;
};

export type TripVisitRef = {
  id: string;
  visitedOn: string;
  authorName: string;
  /** Null when the visit's location is not visible to the caller. */
  location: { id: string; name: string } | null;
};

export type TripPermissions = { canEdit: boolean; canDelete: boolean; canPack: boolean };

export type SerializedTrip = {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  status: TripStatus;
  notes: string;
  /** Sanitized HTML of the trip report. */
  reportHtml: string;
  /** Only for editors. */
  reportMd?: string;
  people: SerializedTripPerson[];
  emergencyContact: SerializedEmergencyContact | null;
  /** Only the stops the caller can see, in order. */
  stops: SerializedTripStop[];
  /** Editors only: stops whose location they can no longer see. */
  hiddenStops?: number;
  checklist: SerializedChecklistItem[];
  visits: TripVisitRef[];
  permissions: TripPermissions;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TripSummary = {
  id: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  status: TripStatus;
  ownerName: string;
  isOwner: boolean;
  /** Stops visible to the caller. */
  stopCount: number;
};
