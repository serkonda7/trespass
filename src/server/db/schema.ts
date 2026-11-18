// Drizzle schema (DESIGN §9). After editing, run `bun run db:generate`
// and commit the generated SQL in ./drizzle. Timestamps are integer milliseconds
// (Drizzle `timestamp_ms` -> Date). Ids are UUIDv7 (Bun.randomUUIDv7).
// Stages add their domain tables here; every edit is followed by `bun run db:generate`.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { GeoJsonPolygon, Point } from "../../lib/geo/types";
import type { PhotoExifData } from "../../lib/photos/types";

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
    /** No trips table yet; a plain nullable reference for the later stage. */
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
