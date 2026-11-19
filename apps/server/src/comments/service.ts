// Threaded comments on locations, visits and photos (DESIGN §5.4). Visibility
// comes only from authz/comments.ts (SQL): a comment is visible exactly when
// its target is. Bodies are Markdown rendered through the same sanitizer as
// journals (no photo embeds). Deleted comments keep their row with an empty
// body so replies stay in place; audits record ids only, never text.
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import {
  type CommentTarget,
  type CreateCommentInput,
  createCommentInput,
  listCommentsInput,
  type UpdateCommentInput,
  updateCommentInput,
} from "@trespass/shared/comments/inputs";
import type { SerializedComment } from "@trespass/shared/comments/types";
import { and, asc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { recordEvent } from "../audit";
import {
  canDeleteComment,
  canEditComment,
  canWriteComment,
  loadLocationForCtx,
  visibleCommentsWhere,
  visiblePhotosWhere,
  visibleVisitsWhere,
} from "../authz";
import type { AppDb, DbOrTx } from "../db/client";
import { type CommentRow, comments, photos, users, visits } from "../db/schema";
import { appForbidden, appInvalid, appNotFound, parseAppInput } from "../errors";
import { renderMarkdown } from "../markdown";

const asDb = (db: DbOrTx) => db as unknown as AppDb;
const notFound = () => appNotFound("COMMENT_NOT_FOUND");

const TARGET_NOT_FOUND: Record<CommentTarget["kind"], string> = {
  location: "LOCATION_NOT_FOUND",
  visit: "VISIT_NOT_FOUND",
  photo: "PHOTO_NOT_FOUND",
};

/** The target column of a comment kind. */
function targetColumn(kind: CommentTarget["kind"]) {
  if (kind === "location") return comments.locationId;
  if (kind === "visit") return comments.visitId;
  return comments.photoId;
}

function targetOf(row: CommentRow): CommentTarget {
  if (row.locationId) return { kind: "location", id: row.locationId };
  if (row.visitId) return { kind: "visit", id: row.visitId };
  return { kind: "photo", id: row.photoId ?? "" };
}

/** 404 (with the target's own code) unless ctx can see the target. */
function requireTarget(db: DbOrTx, ctx: AuthCtx, target: CommentTarget): void {
  let visible = false;
  if (target.kind === "location") {
    visible = loadLocationForCtx(asDb(db), ctx, target.id, "view") !== null;
  } else if (target.kind === "visit") {
    visible = Boolean(
      db
        .select({ id: visits.id })
        .from(visits)
        .where(and(eq(visits.id, target.id), visibleVisitsWhere(ctx, visits)))
        .get(),
    );
  } else {
    visible = Boolean(
      db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.id, target.id), visiblePhotosWhere(ctx, photos)))
        .get(),
    );
  }
  if (!visible) throw appNotFound(TARGET_NOT_FOUND[target.kind]);
}

function requireRow(db: DbOrTx, ctx: AuthCtx, id: string): CommentRow {
  const row = db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), visibleCommentsWhere(ctx, comments)))
    .get();
  if (!row) throw notFound();
  return row;
}

const renderBody = (md: string) => renderMarkdown(md, { resolvePhoto: () => null });

function serialize(ctx: AuthCtx, rows: readonly CommentRow[], names: Map<string, string>) {
  return rows.map((r): SerializedComment => {
    const target = targetOf(r);
    const deleted = r.deletedAt !== null;
    const out: SerializedComment = {
      id: r.id,
      targetKind: target.kind,
      targetId: target.id,
      parentId: r.parentId,
      authorId: r.authorId,
      authorName: names.get(r.authorId) ?? "",
      bodyHtml: deleted ? "" : renderBody(r.bodyMd),
      deleted,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      permissions: {
        canEdit: canEditComment(ctx, r),
        canDelete: canDeleteComment(ctx, r),
        canReply: canWriteComment(ctx) && !deleted,
      },
    };
    if (out.permissions.canEdit) out.bodyMd = r.bodyMd;
    return out;
  });
}

function namesFor(db: DbOrTx, rows: readonly CommentRow[]): Map<string, string> {
  const ids = [...new Set(rows.map((r) => r.authorId))];
  if (ids.length === 0) return new Map();
  return new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, ids))
      .all()
      .map((u) => [u.id, u.name]),
  );
}

// --- Read -------------------------------------------------------------------------

/** All comments on one visible target, oldest first (the UI builds the tree). */
export function listComments(
  db: AppDb,
  ctx: AuthCtx,
  raw: { target: CommentTarget },
): SerializedComment[] {
  const { target } = parseAppInput(listCommentsInput, raw);
  requireTarget(db, ctx, target);
  const rows = db
    .select()
    .from(comments)
    .where(and(eq(targetColumn(target.kind), target.id), visibleCommentsWhere(ctx, comments)))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all();
  return serialize(ctx, rows, namesFor(db, rows));
}

/** Every visible comment, paged by id (export). */
export function* commentPagesForExport(
  db: AppDb,
  ctx: AuthCtx,
  pageSize = 500,
): Generator<SerializedComment[]> {
  let after = "";
  for (;;) {
    const where: SQL[] = [visibleCommentsWhere(ctx, comments)];
    if (after) where.push(gt(comments.id, after));
    const rows = db
      .select()
      .from(comments)
      .where(and(...where))
      .orderBy(asc(comments.id))
      .limit(pageSize)
      .all();
    if (rows.length === 0) return;
    after = rows[rows.length - 1]!.id;
    yield serialize(ctx, rows, namesFor(db, rows));
  }
}

// --- Write ------------------------------------------------------------------------

export function createComment(db: AppDb, ctx: AuthCtx, raw: CreateCommentInput): SerializedComment {
  const input = parseAppInput(createCommentInput, raw);
  return db.transaction((tx) => {
    requireTarget(tx, ctx, input.target);
    if (!canWriteComment(ctx)) throw appForbidden("COMMENT_FORBIDDEN");
    if (input.parentId) {
      const parent = tx
        .select()
        .from(comments)
        .where(and(eq(comments.id, input.parentId), visibleCommentsWhere(ctx, comments)))
        .get();
      const t = parent ? targetOf(parent) : null;
      if (!parent || !t || t.kind !== input.target.kind || t.id !== input.target.id)
        throw appInvalid("COMMENT_PARENT_INVALID");
    }
    const row = tx
      .insert(comments)
      .values({
        authorId: ctx.userId,
        locationId: input.target.kind === "location" ? input.target.id : null,
        visitId: input.target.kind === "visit" ? input.target.id : null,
        photoId: input.target.kind === "photo" ? input.target.id : null,
        parentId: input.parentId ?? null,
        bodyMd: input.bodyMd,
      })
      .returning()
      .get();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "comment.created",
      diff: { commentId: row.id, target: input.target.kind, targetId: input.target.id },
    });
    return serialize(ctx, [row], namesFor(tx, [row]))[0]!;
  });
}

export function updateComment(db: AppDb, ctx: AuthCtx, raw: UpdateCommentInput): SerializedComment {
  const input = parseAppInput(updateCommentInput, raw);
  return db.transaction((tx) => {
    const row = requireRow(tx, ctx, input.id);
    if (!canEditComment(ctx, row)) throw appForbidden("COMMENT_FORBIDDEN");
    const updated = tx
      .update(comments)
      .set({ bodyMd: input.bodyMd, editedAt: new Date() })
      .where(eq(comments.id, row.id))
      .returning()
      .get();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "comment.updated",
      diff: { commentId: row.id },
    });
    return serialize(ctx, [updated], namesFor(tx, [updated]))[0]!;
  });
}

/** Soft delete: the body is wiped, the row stays so replies keep their parent. */
export function deleteComment(db: AppDb, ctx: AuthCtx, id: string): void {
  db.transaction((tx) => {
    const row = requireRow(tx, ctx, id);
    if (!canDeleteComment(ctx, row)) throw appForbidden("COMMENT_FORBIDDEN");
    tx.update(comments)
      .set({ bodyMd: "", deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(comments.id, row.id))
      .run();
    recordEvent(tx, {
      actorId: ctx.userId,
      entityId: row.id,
      action: "comment.deleted",
      diff: { commentId: row.id, moderated: row.authorId !== ctx.userId },
    });
  });
}
