// Builds the reply tree of a flat, oldest-first comment list (UI only).
import type { SerializedComment } from "./types";

export type CommentNode = { comment: SerializedComment; replies: CommentNode[] };

/** Replies whose parent is missing are shown at the top level. */
export function commentTree(list: readonly SerializedComment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  for (const c of list) nodes.set(c.id, { comment: c, replies: [] });
  const roots: CommentNode[] = [];
  for (const c of list) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}
