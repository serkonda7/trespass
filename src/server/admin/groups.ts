// Admin → groups (DESIGN §3.5 "Manage groups": admin only).
// Groups give their members shared visibility through grants when locations
// land; for now they only hold memberships.
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { recordEvent } from "../audit";
import { HttpError, requireRole } from "../auth/context";
import type { AuthCtx } from "../authz/ctx";
import type { AppDb, DbOrTx } from "../db/client";
import { groupMembers, groups, users } from "../db/schema";

export const GROUP_NAME_MAX_LENGTH = 60;

export type AdminGroupRow = {
  id: string;
  name: string;
  members: { id: string; displayName: string; username: string }[];
};

export function listGroups(db: AppDb, ctx: AuthCtx): AdminGroupRow[] {
  requireRole(ctx, "admin");
  const rows = db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .orderBy(asc(groups.name))
    .all();
  const members = db
    .select({
      groupId: groupMembers.groupId,
      id: users.id,
      displayName: users.displayName,
      username: users.username,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .orderBy(asc(users.displayName))
    .all();
  return rows.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.groupId === g.id)
      .map(({ id, displayName, username }) => ({ id, displayName, username })),
  }));
}

function cleanName(name: string): string {
  const v = name.trim().replace(/\s+/g, " ");
  if (!v || v.length > GROUP_NAME_MAX_LENGTH) throw new HttpError(422, "GROUP_NAME_INVALID");
  return v;
}

function assertNameFree(db: DbOrTx, name: string, exceptId?: string) {
  const clash = db
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        sql`lower(${groups.name}) = lower(${name})`,
        exceptId ? ne(groups.id, exceptId) : undefined,
      ),
    )
    .get();
  if (clash) throw new HttpError(409, "GROUP_NAME_TAKEN");
}

function findGroup(db: DbOrTx, groupId: string) {
  const g = db.select().from(groups).where(eq(groups.id, groupId)).get();
  if (!g) throw new HttpError(404, "NOT_FOUND");
  return g;
}

export function createGroup(db: AppDb, ctx: AuthCtx, input: { name: string }) {
  requireRole(ctx, "admin");
  const name = cleanName(input.name);
  return db.transaction((tx) => {
    assertNameFree(tx, name);
    const g = tx.insert(groups).values({ name }).returning().get();
    recordEvent(tx, {
      actorId: ctx.userId,
      action: "group.created",
      diff: { groupId: g.id, name },
    });
    return { id: g.id, name: g.name };
  });
}

export function renameGroup(db: AppDb, ctx: AuthCtx, input: { groupId: string; name: string }) {
  requireRole(ctx, "admin");
  const name = cleanName(input.name);
  db.transaction((tx) => {
    const g = findGroup(tx, input.groupId);
    if (g.name === name) return;
    assertNameFree(tx, name, g.id);
    tx.update(groups).set({ name }).where(eq(groups.id, g.id)).run();
    recordEvent(tx, {
      actorId: ctx.userId,
      action: "group.renamed",
      diff: { groupId: g.id, from: g.name, to: name },
    });
  });
}

export function deleteGroup(db: AppDb, ctx: AuthCtx, input: { groupId: string }) {
  requireRole(ctx, "admin");
  db.transaction((tx) => {
    const g = findGroup(tx, input.groupId);
    const memberCount = tx
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, g.id))
      .all().length;
    tx.delete(groups).where(eq(groups.id, g.id)).run(); // memberships cascade
    recordEvent(tx, {
      actorId: ctx.userId,
      action: "group.deleted",
      diff: { groupId: g.id, name: g.name, members: memberCount },
    });
  });
}

export function addGroupMember(
  db: AppDb,
  ctx: AuthCtx,
  input: { groupId: string; userId: string },
) {
  requireRole(ctx, "admin");
  db.transaction((tx) => {
    const g = findGroup(tx, input.groupId);
    const u = tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    if (!u) throw new HttpError(404, "NOT_FOUND");
    const added = tx
      .insert(groupMembers)
      .values({ groupId: g.id, userId: u.id })
      .onConflictDoNothing()
      .returning()
      .get();
    if (!added) return;
    recordEvent(tx, {
      actorId: ctx.userId,
      action: "group.member_added",
      diff: { groupId: g.id, group: g.name, userId: u.id, username: u.username },
    });
  });
}

export function removeGroupMember(
  db: AppDb,
  ctx: AuthCtx,
  input: { groupId: string; userId: string },
) {
  requireRole(ctx, "admin");
  db.transaction((tx) => {
    const g = findGroup(tx, input.groupId);
    const removed = tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.userId, input.userId)))
      .returning()
      .get();
    if (!removed) return;
    const u = tx
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    recordEvent(tx, {
      actorId: ctx.userId,
      action: "group.member_removed",
      diff: { groupId: g.id, group: g.name, userId: input.userId, username: u?.username ?? null },
    });
  });
}
