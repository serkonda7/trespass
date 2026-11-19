// Export archive (GET /api/v1/export): shared constants and shapes. The layout
// is the contract in docs/export-format.md; bump EXPORT_FORMAT_VERSION whenever
// a file or field changes meaning.
export const EXPORT_FORMAT = "trespass-export";
export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_URL = "/api/v1/export";

/** Mirrors `exportScope()` in server/authz/actions.ts (admin/all, member/visible). */
export type ExportScopeName = "all" | "own_and_visible";

export type ExportPhase = "data" | "files" | "finishing";

export type ExportProgress = {
  startedAt: Date;
  phase: ExportPhase;
  bytesWritten: number;
  filesDone: number;
  filesTotal: number;
};

export type ExportCounts = {
  locations: number;
  categories: number;
  tags: number;
  visits: number;
  journals: number;
  photos: number;
  photoFiles: number;
  skippedPhotos: number;
  grants: number;
  users: number;
  history: number;
  comments: number;
  trips: number;
  equipment: number;
  packTemplates: number;
};

/** What /admin/export shows before and while an export runs. */
export type ExportInfo = {
  scope: ExportScopeName;
  estimate: { locations: number; visits: number; photos: number; fileBytes: number };
  active: ExportProgress | null;
  last: { finishedAt: Date; completed: boolean; bytes: number } | null;
};
