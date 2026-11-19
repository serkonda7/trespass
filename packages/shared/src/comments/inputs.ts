// Zod inputs for comments (DESIGN §5.4). Shared by the UI and the service.
import { z } from "zod";
import { idSchema } from "../locations/inputs";

export const COMMENT_MAX = 5000;
export const COMMENT_TARGET_KINDS = ["location", "visit", "photo"] as const;
export type CommentTargetKind = (typeof COMMENT_TARGET_KINDS)[number];

export const commentTargetSchema = z.object({
  kind: z.enum(COMMENT_TARGET_KINDS),
  id: idSchema,
});
export type CommentTarget = z.output<typeof commentTargetSchema>;

const body = z.string().trim().min(1).max(COMMENT_MAX);

export const createCommentInput = z.object({
  target: commentTargetSchema,
  parentId: idSchema.optional(),
  bodyMd: body,
});
export type CreateCommentInput = z.input<typeof createCommentInput>;

export const updateCommentInput = z.object({ id: idSchema, bodyMd: body });
export type UpdateCommentInput = z.input<typeof updateCommentInput>;

export const commentIdInput = z.object({ id: idSchema });
export const listCommentsInput = z.object({ target: commentTargetSchema });
