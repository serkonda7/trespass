// Drizzle schema (DESIGN §9). After editing, run `bun run db:generate`
// and commit the generated SQL in ./drizzle. Timestamps are integer milliseconds
// (Drizzle `timestamp_ms` -> Date). Ids are UUIDv7 (Bun.randomUUIDv7).
// Only the foundation is present so far; domain tables are added in later stages.
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ROLES = ["admin", "member", "guest"] as const;
export const PRINCIPAL_KINDS = ["user", "group"] as const;

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
