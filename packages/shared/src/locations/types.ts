// Output shapes for location server functions. Shared by server and client;
// no server-only imports here. The precise-only fields are optional: below
// `precise` they are absent from the object entirely (serialize.ts).
import type { GeoJsonPolygon, Point } from "../geo/types";

export type LocationStatus =
  | "idea"
  | "researched"
  | "planned"
  | "visited"
  | "sealed"
  | "redeveloped"
  | "demolished";
/** Statuses a user may set; `visited` is derived from visits. */
export type StoredLocationStatus = Exclude<LocationStatus, "visited">;
export type Visibility = "private" | "friends";
export type FriendsLevel = "view" | "contribute" | "precise";
export type LocationGrantLevel = "view" | "contribute" | "precise" | "edit" | "manage";
export type PrincipalKind = "user" | "group";
export type LocationLevel = "none" | "view" | "contribute" | "precise" | "edit" | "manage";
export type VisibleLocationLevel = Exclude<LocationLevel, "none">;

export type LocationPermissions = {
  canContribute: boolean;
  canSeeExact: boolean;
  canEdit: boolean;
  canManage: boolean;
};

export type LocationCategoryRef = { id: string; key: string; name: string; icon: string };

export type GrantRow = {
  principalKind: PrincipalKind;
  principalId: string;
  level: LocationGrantLevel;
  principalName: string;
};

/** What leaves the server for one location. Coordinates live only in `point`. */
export type SerializedLocation = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  categoryId: string;
  /** Effective status (`visited` derived from visits, §2). */
  status: LocationStatus;
  /** The stored status, for the edit form (never `visited`). */
  storedStatus: StoredLocationStatus;
  point: Point;
  /** True when `point` is the exact position; false when it is the fuzzed one. */
  exact: boolean;
  country: string | null;
  adminArea: string | null;
  tz: string;
  builtYear: number | null;
  abandonedYear: number | null;
  coverPhotoId: string | null;
  visibility: Visibility;
  friendsLevel: FriendsLevel;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  level: VisibleLocationLevel;
  permissions: LocationPermissions;
  /** Precise only. Never present below `precise`. */
  fuzzRadiusM?: number;
  geomArea?: GeoJsonPolygon | null;
  parking?: Point[] | null;
  accessNotes?: string | null;
  dangerNotes?: string | null;
  /** Supplied by the caller when available (see SerializeExtra). */
  category?: LocationCategoryRef | null;
  tags?: string[];
  ownerName?: string | null;
  /** Manage only. Never present below `manage`. */
  grants?: GrantRow[] | null;
};

/** Lightweight row for maps and lists. */
export type LocationListItem = {
  id: string;
  name: string;
  categoryKey: string;
  categoryIcon: string;
  status: LocationStatus;
  storedStatus: StoredLocationStatus;
  point: Point;
  exact: boolean;
  level: VisibleLocationLevel;
  country: string | null;
};

export type LocationDetail = {
  location: SerializedLocation;
  category: LocationCategoryRef | null;
  tags: string[];
  ownerName: string | null;
  grants: GrantRow[] | null;
};

export type CategoryRow = LocationCategoryRef;

export type DuplicateMatch = {
  id: string;
  name: string;
  point: Point;
  reason: "nearby" | "similar_name";
};

/** A user or group that can receive a location grant. */
export type PrincipalOption = {
  kind: PrincipalKind;
  id: string;
  name: string;
  detail: string;
  /** Users only; groups may contain members of any role. */
  role?: "admin" | "member" | "guest";
};
