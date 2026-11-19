// Drizzle schema (DESIGN §9). After editing, run `bun run db:generate`
// and commit the generated SQL in ./drizzle. Timestamps are integer milliseconds
// (Drizzle `timestamp_ms` -> Date). Ids are UUIDv7 (Bun.randomUUIDv7).
// Stages add their domain tables here; every edit is followed by `bun run db:generate`.

import type { GeoJsonPolygon, Point } from "@trespass/shared/geo/types";
import type { PhotoExifData } from "@trespass/shared/photos/types";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const ROLES = ["admin", "member", "guest"] as const;
export const PRINCIPAL_KINDS = ["user", "group"] as const;
/** Non-derived statuses; `visited` is computed from visits in Stage 4 (DESIGN §2, §9). */
export const LOCATION_STATUSES = [
  "idea",
  "researched",
  "planned",
  "sealed",
  "redeveloped",
  "demolished",
] as const;
export const VISIBILITIES = ["private", "friends"] as const;
export const FRIENDS_LEVELS = ["view", "contribute", "precise"] as const;
export const LOCATION_GRANT_LEVELS = ["view", "contribute", "precise", "edit", "manage"] as const;
export const VISIT_ACCESS = ["open", "difficult", "sealed"] as const;
export const VISIT_CONDITIONS = ["good", "fair", "poor", "collapsing"] as const;
export const PHOTO_STATUSES = ["processing", "ready", "failed"] as const;
export const TILE_REGION_KINDS = ["world", "region"] as const;
export const TILE_REGION_STATUSES = ["pending", "extracting", "ready", "failed"] as const;
export const HISTORY_PRECISIONS = ["day", "month", "year", "decade", "circa"] as const;
export const HISTORY_STATUSES = ["draft", "approved"] as const;
/** `skipped`: ARCHIVE=off when the source was saved; nothing was sent to archive.org. */
export const ARCHIVE_STATUSES = ["pending", "done", "failed", "skipped"] as const;
export const EQUIPMENT_CATEGORIES = [
  "light",
  "protection",
  "photo",
  "navigation",
  "first_aid",
  "tools",
  "other",
] as const;
export const TRIP_STATUSES = ["planned", "active", "done", "cancelled"] as const;

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => Bun.randomUUIDv7());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(",")})`);

// --- Server -----------------------------------------------------------------
/** One row per server start. deploy/restore-test.sh compares its count. */
export const boots = sqliteTable("boots", {
  id: integer("id").primaryKey(),
  at: text("at").notNull(),
});

// --- Identity ---------------------------------------------------------------
/** Instance-wide settings singleton (id = 1), inserted by the init migration. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    instanceName: text("instance_name").notNull().default("Trespass"),
    researchBudgetCents: integer("research_budget_cents").notNull().default(0),
    tileBudgetMb: integer("tile_budget_mb").notNull().default(10240),
    defaultFuzzM: integer("default_fuzz_m").notNull().default(1500),
  },
  () => [check("settings_singleton", sql`id = 1`)],
);

/**
 * Users. Shared with Better Auth (model "user", plural "users"):
 *  - Better Auth's required `email` is mapped to `auth_email`, an internal,
 *    synthetic unique value (`<id>@users.invalid`).
 *  - Better Auth's `name` is mapped to `display_name`.
 *  - `username` / `display_username` come from the username plugin.
 */
export const users = sqliteTable(
  "users",
  {
    id: id(),
    username: text("username").notNull().unique(),
    displayUsername: text("display_username"),
    displayName: text("display_name").notNull(),
    authEmail: text("auth_email").notNull().unique(),
    email: text("email").unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    locale: text("locale").notNull().default("de-DE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    disabledAt: integer("disabled_at", { mode: "timestamp_ms" }),
  },
  () => [check("users_role", inList("role", ROLES))],
);

// Better Auth owns sessions, accounts (password hash), verifications and passkeys.
export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const passkeys = sqliteTable(
  "passkeys",
  {
    id: id(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    aaguid: text("aaguid"),
  },
  (t) => [
    index("passkeys_user_idx").on(t.userId),
    index("passkeys_credential_idx").on(t.credentialID),
  ],
);

export const groups = sqliteTable("groups", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_group_idx").on(t.groupId),
    index("group_members_user_idx").on(t.userId),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: id(),
    role: text("role", { enum: ROLES }).notNull(),
    /** SHA-256 of the invite token; the token itself is only in the link. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
  },
  () => [check("invites_role", inList("role", ROLES))],
);

// --- Places -----------------------------------------------------------------
/** Seeded and admin-editable category (DESIGN §2). Keys are stable identifiers. */
export const categories = sqliteTable("categories", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("circle"),
  sort: integer("sort").notNull().default(0),
});

/**
 * One abandoned place (DESIGN §4, §9). `lat/lon` is exact; `pub_lat/pub_lon` is
 * the single stable fuzzed point shown below `precise`. `cover_photo_id` has no
 * FK yet: photos arrive in Stage 3.
 */
export const locations = sqliteTable(
  "locations",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    /** Normalized name for case/diacritic-insensitive sorting and duplicate checks. */
    nameSort: text("name_sort").notNull(),
    description: text("description"),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    // `visited` is derived from visits; only the non-derived statuses are stored.
    status: text("status", { enum: LOCATION_STATUSES }).notNull().default("idea"),
    /** When `status` last changed; the effective status uses it against visits. */
    statusChangedAt: integer("status_changed_at", { mode: "timestamp_ms" }),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    pubLat: real("pub_lat").notNull(),
    pubLon: real("pub_lon").notNull(),
    fuzzRadiusM: integer("fuzz_radius_m").notNull().default(1500),
    geomArea: text("geom_area", { mode: "json" }).$type<GeoJsonPolygon>(),
    parking: text("parking", { mode: "json" }).$type<Point[]>(),
    accessNotes: text("access_notes"),
    dangerNotes: text("danger_notes"),
    country: text("country"),
    adminArea: text("admin_area"),
    tz: text("tz").notNull(),
    builtYear: integer("built_year"),
    abandonedYear: integer("abandoned_year"),
    /**
     * Cover photo of this location. No FK: the photos table references
     * locations, and a circular FK would make Drizzle's table types recursive.
     * The service validates the photo and clears the cover on photo delete.
     */
    coverPhotoId: text("cover_photo_id"),
    visibility: text("visibility", { enum: VISIBILITIES }).notNull().default("private"),
    friendsLevel: text("friends_level", { enum: FRIENDS_LEVELS }).notNull().default("view"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("locations_status", inList("status", LOCATION_STATUSES)),
    check("locations_visibility", inList("visibility", VISIBILITIES)),
    check("locations_friends_level", inList("friends_level", FRIENDS_LEVELS)),
    index("locations_lat_lon_idx").on(t.lat, t.lon),
    index("locations_pub_lat_lon_idx").on(t.pubLat, t.pubLon),
    index("locations_owner_idx").on(t.ownerId),
    index("locations_category_idx").on(t.categoryId),
  ],
);

/**
 * Per-location grants. `principalId` deliberately has no FK: a grant may
 * outlive its user/group, and authorization must stay deterministic.
 */
export const locationGrants = sqliteTable(
  "location_grants",
  {
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    principalKind: text("principal_kind", { enum: PRINCIPAL_KINDS }).notNull(),
    principalId: text("principal_id").notNull(),
    level: text("level", { enum: LOCATION_GRANT_LEVELS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.locationId, t.principalKind, t.principalId] }),
    check("location_grants_level", inList("level", LOCATION_GRANT_LEVELS)),
    index("location_grants_principal_idx").on(t.principalKind, t.principalId),
  ],
);

/** Tag names are stored normalized (lower-case, diacritic-free). */
export const tags = sqliteTable("tags", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const locationTags = sqliteTable(
  "location_tags",
  {
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.tagId] })],
);

// --- Journal ----------------------------------------------------------------
/** Structured conditions of one visit (DESIGN §5.2). Stored as JSON. */
export type VisitConditions = {
  access?: (typeof VISIT_ACCESS)[number];
  securitySeen?: boolean;
  condition?: (typeof VISIT_CONDITIONS)[number];
  hazards?: string[];
};

/**
 * One time someone was at a location. `visitedOn` is the LOCAL date in the
 * location's time zone; timestamps are UTC. Inherits its location's visibility.
 */
export const visits = sqliteTable(
  "visits",
  {
    id: id(),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    visitedOn: text("visited_on").notNull(),
    conditions: text("conditions", { mode: "json" })
      .$type<VisitConditions>()
      .notNull()
      .default(sql`'{}'`),
    journalMd: text("journal_md").notNull().default(""),
    /**
     * The trip this visit belonged to. No DB FK (added before the trips table
     * existed); the trip service validates it and clears it on trip delete.
     */
    tripId: text("trip_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("visits_location_date_idx").on(t.locationId, t.visitedOn),
    index("visits_author_idx").on(t.authorId),
  ],
);

/** People on a visit: either a user or a free name (DESIGN §9, §5.2). */
export const visitPeople = sqliteTable(
  "visit_people",
  {
    id: id(),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id),
    name: text("name"),
  },
  (t) => [
    check("visit_people_exactly_one", sql`(user_id IS NULL) <> (name IS NULL)`),
    index("visit_people_visit_idx").on(t.visitId),
  ],
);

// --- Photos -----------------------------------------------------------------
/**
 * One uploaded photo (DESIGN §5.3, §9). The original is stored content-addressed
 * under UPLOAD_DIR; only derivatives are served to other users. EXIF is read by
 * the worker before stripping and reduced to `exif` (camera/lens/exposure only —
 * never GPS or serials). `gps_lat/gps_lon` are exact data (DESIGN §3.4 rule 4).
 * Auto-matching only SUGGESTS a location/visit, it never attaches one.
 */
export const photos = sqliteTable(
  "photos",
  {
    id: id(),
    sha256: text("sha256").notNull(),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    visitId: text("visit_id").references(() => visits.id, { onDelete: "set null" }),
    takenAt: integer("taken_at", { mode: "timestamp_ms" }),
    gpsLat: real("gps_lat"),
    gpsLon: real("gps_lon"),
    exif: text("exif", { mode: "json" }).$type<PhotoExifData>().notNull().default(sql`'{}'`),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    caption: text("caption"),
    sort: integer("sort").notNull().default(0),
    status: text("status", { enum: PHOTO_STATUSES }).notNull().default("processing"),
    originalName: text("original_name"),
    suggestedLocationId: text("suggested_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    suggestedVisitId: text("suggested_visit_id").references(() => visits.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check("photos_status", inList("status", PHOTO_STATUSES)),
    index("photos_location_idx").on(t.locationId),
    index("photos_visit_idx").on(t.visitId),
    index("photos_uploader_idx").on(t.uploaderId),
    index("photos_sha256_idx").on(t.sha256),
  ],
);

// --- History and sources ---------------------------------------------------
/**
 * Dated facts about a location (DESIGN §5.4). `date_from`/`date_to` hold as many
 * ISO parts as the precision needs: 'YYYY-MM-DD' (day), 'YYYY-MM' (month) or
 * 'YYYY' (year, decade, circa), so they sort lexicographically. Drafts are
 * visible only at `edit`; approved entries at `view` (and are searchable).
 */
export const history = sqliteTable(
  "history",
  {
    id: id(),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to"),
    datePrecision: text("date_precision", { enum: HISTORY_PRECISIONS }).notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: HISTORY_STATUSES }).notNull().default("approved"),
    /** Research candidate this entry came from (v1.3); no FK yet. */
    candidateId: text("candidate_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("history_precision", inList("date_precision", HISTORY_PRECISIONS)),
    check("history_status", inList("status", HISTORY_STATUSES)),
    index("history_location_idx").on(t.locationId, t.dateFrom),
  ],
);

/**
 * A source backing one history entry. Sources belong to exactly one entry (no
 * join table): a source never needs its own visibility rule, it simply inherits
 * the entry's. `archived_url` is the Wayback Machine copy requested on save.
 */
export const sources = sqliteTable(
  "sources",
  {
    id: id(),
    historyId: text("history_id")
      .notNull()
      .references(() => history.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    /** Local day ('YYYY-MM-DD') the source was read. */
    retrievedOn: text("retrieved_on").notNull(),
    excerpt: text("excerpt"),
    archivedUrl: text("archived_url"),
    archiveStatus: text("archive_status", { enum: ARCHIVE_STATUSES }).notNull().default("pending"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("sources_archive_status", inList("archive_status", ARCHIVE_STATUSES)),
    index("sources_history_idx").on(t.historyId),
  ],
);

// --- Comments ---------------------------------------------------------------
/**
 * Threaded comments on a location, a visit or a photo (DESIGN §5.4). Exactly one
 * target column is set; FKs cascade so a deleted target takes its comments with
 * it. A deleted comment keeps its row (replies stay attached) with an empty body.
 */
export const comments = sqliteTable(
  "comments",
  {
    id: id(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
    visitId: text("visit_id").references(() => visits.id, { onDelete: "cascade" }),
    photoId: text("photo_id").references(() => photos.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => comments.id, {
      onDelete: "cascade",
    }),
    bodyMd: text("body_md").notNull(),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    deletedBy: text("deleted_by"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "comments_one_target",
      sql`((location_id IS NOT NULL) + (visit_id IS NOT NULL) + (photo_id IS NOT NULL)) = 1`,
    ),
    index("comments_location_idx").on(t.locationId, t.createdAt),
    index("comments_visit_idx").on(t.visitId, t.createdAt),
    index("comments_photo_idx").on(t.photoId, t.createdAt),
    index("comments_parent_idx").on(t.parentId),
  ],
);

// --- Equipment and trips ----------------------------------------------------
/** Personal gear (DESIGN §5.5). Private to its owner. */
export const equipment = sqliteTable(
  "equipment",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category", { enum: EQUIPMENT_CATEGORIES }).notNull().default("other"),
    weightG: integer("weight_g"),
    needsCharging: integer("needs_charging", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("equipment_category", inList("category", EQUIPMENT_CATEGORIES)),
    index("equipment_owner_idx").on(t.ownerId),
  ],
);

export const packTemplates = sqliteTable(
  "pack_templates",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("pack_templates_owner_idx").on(t.ownerId)],
);

export const packTemplateItems = sqliteTable(
  "pack_template_items",
  {
    templateId: text("template_id")
      .notNull()
      .references(() => packTemplates.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.equipmentId] })],
);

/** Emergency contact of a trip: an app user, or someone outside with e-mail or ntfy. */
export type EmergencyContact =
  | { userId: string }
  | { name: string; email?: string | null; ntfyTopic?: string | null };

/**
 * A planned or completed outing (DESIGN §5.5). Visible to its owner, its
 * people (app users) and admins. Stops show only locations the viewer can see.
 */
export const trips = sqliteTable(
  "trips",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    notes: text("notes").notNull().default(""),
    reportMd: text("report_md").notNull().default(""),
    emergencyContact: text("emergency_contact", { mode: "json" }).$type<EmergencyContact>(),
    status: text("status", { enum: TRIP_STATUSES }).notNull().default("planned"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("trips_status", inList("status", TRIP_STATUSES)),
    index("trips_owner_idx").on(t.ownerId),
    index("trips_starts_idx").on(t.startsOn),
  ],
);

export const tripStops = sqliteTable(
  "trip_stops",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.locationId] }),
    index("trip_stops_location_idx").on(t.locationId),
  ],
);

export const tripPeople = sqliteTable(
  "trip_people",
  {
    id: id(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id),
    name: text("name"),
  },
  (t) => [
    check("trip_people_exactly_one", sql`(user_id IS NULL) <> (name IS NULL)`),
    index("trip_people_trip_idx").on(t.tripId),
    index("trip_people_user_idx").on(t.userId),
  ],
);

/** One packing-list line. `label` is copied from the equipment so it survives its deletion. */
export const tripChecklist = sqliteTable(
  "trip_checklist",
  {
    id: id(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    packed: integer("packed", { mode: "boolean" }).notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("trip_checklist_trip_idx").on(t.tripId)],
);

// --- Map tiles --------------------------------------------------------------
/**
 * One locally extracted tile region (DESIGN §7/§9). `lat/lon` is the exact box
 * sent to the extractor; it is never shown at full precision in the UI (the
 * admin page rounds it). The tiles themselves live in the separate MBTiles
 * file at TILES_PATH, which only the worker writes. The box may cross the
 * antimeridian (minLon > maxLon); the extractor splits it in that case.
 */
export const tileRegions = sqliteTable(
  "tile_regions",
  {
    id: id(),
    kind: text("kind", { enum: TILE_REGION_KINDS }).notNull().default("region"),
    minLat: real("min_lat").notNull(),
    minLon: real("min_lon").notNull(),
    maxLat: real("max_lat").notNull(),
    maxLon: real("max_lon").notNull(),
    minZoom: integer("min_zoom").notNull(),
    maxZoom: integer("max_zoom").notNull(),
    /** Protomaps daily build this region was extracted from ('YYYY-MM-DD'). */
    buildDate: integer("build_date", { mode: "timestamp_ms" }),
    /** Approximate size of the tiles written for this region, in bytes. */
    bytes: integer("bytes"),
    status: text("status", { enum: TILE_REGION_STATUSES }).notNull().default("pending"),
    error: text("error"),
    createdAt: createdAt(),
    refreshedAt: integer("refreshed_at", { mode: "timestamp_ms" }),
    /** Set by tiles.prune when no location lies inside any more. */
    emptySince: integer("empty_since", { mode: "timestamp_ms" }),
  },
  (t) => [
    check("tile_regions_kind", inList("kind", TILE_REGION_KINDS)),
    check("tile_regions_status", inList("status", TILE_REGION_STATUSES)),
    check("tile_regions_zoom", sql`${t.minZoom} <= ${t.maxZoom}`),
  ],
);

// --- Activity ---------------------------------------------------------------
/**
 * Event log. No FK on entity_id/actor_id on purpose: history outlives deletions.
 * `entityId` is a generic link to the affected record, not a domain object.
 */
export const events = sqliteTable(
  "events",
  {
    id: id(),
    entityId: text("entity_id"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    diff: text("diff", { mode: "json" }).$type<unknown>(),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("events_entity_idx").on(t.entityId, t.at), index("events_at_idx").on(t.at)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull().default(sql`'{}'`),
    runAt: integer("run_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
  },
  (t) => [index("jobs_due_idx").on(t.doneAt, t.runAt)],
);

// --- Row types --------------------------------------------------------------
export type Settings = typeof settings.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Passkey = typeof passkeys.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type LocationGrant = typeof locationGrants.$inferSelect;
export type NewLocationGrant = typeof locationGrants.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type LocationTag = typeof locationTags.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;
export type VisitPersonRow = typeof visitPeople.$inferSelect;
export type NewVisitPerson = typeof visitPeople.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type HistoryRow = typeof history.$inferSelect;
export type NewHistory = typeof history.$inferInsert;
export type SourceRow = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type CommentRow = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type EquipmentRow = typeof equipment.$inferSelect;
export type PackTemplateRow = typeof packTemplates.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type TripStopRow = typeof tripStops.$inferSelect;
export type TripPersonRow = typeof tripPeople.$inferSelect;
export type TripChecklistRow = typeof tripChecklist.$inferSelect;
export type TileRegion = typeof tileRegions.$inferSelect;
export type NewTileRegion = typeof tileRegions.$inferInsert;
