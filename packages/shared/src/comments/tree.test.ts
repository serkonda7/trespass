import { expect, test } from "bun:test";
import { commentTree } from "./tree";
import type { SerializedComment } from "./types";

const c = (id: string, parentId: string | null): SerializedComment => ({
  id,
  parentId,
  targetKind: "location",
  targetId: "l",
  authorId: "a",
  authorName: "A",
  bodyHtml: "",
  deleted: false,
  createdAt: new Date(0),
  editedAt: null,
  permissions: { canEdit: false, canDelete: false, canReply: false },
});

test("nests replies and keeps orphans at the top", () => {
  const tree = commentTree([c("1", null), c("2", "1"), c("3", "2"), c("4", "missing")]);
  expect(tree.map((n) => n.comment.id)).toEqual(["1", "4"]);
  expect(tree[0]!.replies[0]!.comment.id).toBe("2");
  expect(tree[0]!.replies[0]!.replies[0]!.comment.id).toBe("3");
});
