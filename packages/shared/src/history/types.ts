// Output shapes of the history server functions. No server-only imports.
import type { HistoryPrecision } from "./inputs";

export type HistoryStatus = "draft" | "approved";
export type ArchiveStatus = "pending" | "done" | "failed" | "skipped";

export type SerializedSource = {
  id: string;
  url: string;
  title: string | null;
  retrievedOn: string;
  excerpt: string | null;
  archivedUrl: string | null;
  archiveStatus: ArchiveStatus;
};

export type HistoryPermissions = { canEdit: boolean; canDelete: boolean; canApprove: boolean };

export type SerializedHistory = {
  id: string;
  locationId: string;
  datePrecision: HistoryPrecision;
  dateFrom: string;
  dateTo: string | null;
  text: string;
  /** Drafts only ever reach callers with `edit` on the location. */
  status: HistoryStatus;
  sources: SerializedSource[];
  createdByName: string | null;
  permissions: HistoryPermissions;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};
