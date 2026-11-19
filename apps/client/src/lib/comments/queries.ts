// Query options for comment threads.
import { queryOptions } from "@tanstack/solid-query";
import { listCommentsFn } from "@trespass/server/comments/functions";
import type { CommentTarget } from "@trespass/shared/comments/inputs";

export const commentsQueryKey = (target: CommentTarget) =>
  ["comments", target.kind, target.id] as const;

export const commentsQuery = (target: CommentTarget) =>
  queryOptions({
    queryKey: commentsQueryKey(target),
    queryFn: () => listCommentsFn({ data: { target } }),
  });
