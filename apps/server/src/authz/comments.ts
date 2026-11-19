// The ONLY place that decides who may see or write comments (DESIGN §3.3,
// §5.4). A comment inherits the visibility of its target (location, visit or
// photo) through the target's own SQL predicate. Guests read but never write.
import type { AuthCtx } from "@trespass/shared/authz/ctx";
import { eq, or, type SQL, sql } from "drizzle-orm";
import { comments, locations, photos, visits } from "../db/schema";
import { visiblePhotosWhere } from "./photos";
import { visibleLocationsWhere } from "./predicates";
import { visibleVisitsWhere } from "./visits";

/** True exactly where a comment's target is visible. AND it into every comment query. */
export function visibleCommentsWhere(ctx: AuthCtx, table: typeof comments = comments): SQL {
  return or(
    sql`exists (select 1 from ${locations} where ${eq(locations.id, table.locationId)} and ${visibleLocationsWhere(ctx, locations)})`,
    sql`exists (select 1 from ${visits} where ${eq(visits.id, table.visitId)} and ${visibleVisitsWhere(ctx, visits)})`,
    sql`exists (select 1 from ${photos} where ${eq(photos.id, table.photoId)} and ${visiblePhotosWhere(ctx, photos)})`,
  ) as SQL;
}

export const canWriteComment = (ctx: AuthCtx): boolean => ctx.role !== "guest";

type CommentLike = { authorId: string; deletedAt: Date | null };

/** Only the author edits, and only while the comment exists. */
export const canEditComment = (ctx: AuthCtx, c: CommentLike): boolean =>
  canWriteComment(ctx) && !c.deletedAt && c.authorId === ctx.userId;

/** The author deletes their own; admins moderate everything. */
export const canDeleteComment = (ctx: AuthCtx, c: CommentLike): boolean =>
  !c.deletedAt && (ctx.role === "admin" || (canWriteComment(ctx) && c.authorId === ctx.userId));
