// Output shape of the comment server functions. No server-only imports.
import type { CommentTargetKind } from "./inputs";

export type CommentPermissions = { canEdit: boolean; canDelete: boolean; canReply: boolean };

export type SerializedComment = {
  id: string;
  targetKind: CommentTargetKind;
  targetId: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  /** Sanitized HTML from the server; empty for deleted comments. */
  bodyHtml: string;
  /** Only present for the author while they may edit it. */
  bodyMd?: string;
  deleted: boolean;
  createdAt: Date;
  editedAt: Date | null;
  permissions: CommentPermissions;
};
