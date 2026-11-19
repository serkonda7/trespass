// Server functions for comments. Logic and permission checks live in
// ./service.ts; these add authMiddleware and input validation.
import { createServerFn } from "@tanstack/solid-start";
import {
  commentIdInput,
  createCommentInput,
  listCommentsInput,
  updateCommentInput,
} from "@trespass/shared/comments/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { createComment, deleteComment, listComments, updateComment } from "./service";

export const listCommentsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listCommentsInput)
  .handler(({ context: { ctx }, data }) => listComments(getDb(), ctx, data));

export const createCommentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createCommentInput)
  .handler(({ context: { ctx }, data }) => createComment(getDb(), ctx, data));

export const updateCommentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateCommentInput)
  .handler(({ context: { ctx }, data }) => updateComment(getDb(), ctx, data));

export const deleteCommentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(commentIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteComment(getDb(), ctx, data.id);
    return { ok: true as const };
  });
