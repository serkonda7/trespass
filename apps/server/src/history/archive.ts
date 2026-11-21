// Wayback Machine copies of history sources (DESIGN §5.4, §8.6). On save the
// service enqueues `sources.archive`; the worker asks archive.org to save the
// page and records the snapshot URL. Only the source URL is sent, with a
// generic User-Agent. ARCHIVE=off disables the job entirely and marks new
// sources `skipped`.
import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { sources } from "../db/schema";
import { getEnv } from "../env";
import type { JobContext } from "../jobs/worker";

export const ARCHIVE_USER_AGENT = "trespass/0.1";
export const ARCHIVE_MAX_ATTEMPTS = 3;

export type ArchiveFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: "follow" },
) => Promise<Response>;

export const archiveEnabled = (): boolean => getEnv().ARCHIVE === "on";

const SNAPSHOT = /^https?:\/\/web\.archive\.org\/web\/\d{8,14}[a-z_]*\/.+/i;

function snapshotFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  const absolute = value.startsWith("/web/") ? `https://web.archive.org${value}` : value;
  return SNAPSHOT.test(absolute) ? absolute.replace(/^http:/i, "https:") : null;
}

/**
 * Asks the Wayback Machine to save `url` and returns the snapshot URL. Falls
 * back to the closest existing snapshot when the save answer has none.
 */
export async function requestArchive(
  url: string,
  deps: { fetch?: ArchiveFetch; signal?: AbortSignal } = {},
): Promise<string> {
  const doFetch = deps.fetch ?? (fetch as ArchiveFetch);
  const headers = { "User-Agent": ARCHIVE_USER_AGENT };
  const save = await doFetch(`https://web.archive.org/save/${url}`, {
    headers,
    signal: deps.signal,
    redirect: "follow",
  });
  const fromSave =
    snapshotFrom(save.headers.get("content-location")) ??
    snapshotFrom(save.headers.get("location")) ??
    snapshotFrom(save.url);
  if (fromSave) return fromSave;

  const lookup = await doFetch(
    `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
    { headers, signal: deps.signal },
  );
  if (lookup.ok) {
    const body = (await lookup.json()) as {
      archived_snapshots?: { closest?: { url?: string; available?: boolean } };
    };
    const closest = body.archived_snapshots?.closest;
    const found = closest?.available === false ? null : snapshotFrom(closest?.url);
    if (found) return found;
  }
  throw new Error(`archive.org returned ${save.status} without a snapshot`);
}

export type ArchivePayload = { sourceId: string };

const isPayload = (v: unknown): v is ArchivePayload =>
  Boolean(v) && typeof (v as ArchivePayload).sourceId === "string";

/**
 * The `sources.archive` handler. Idempotent: does nothing unless the source
 * still exists and is pending. The last failed attempt marks it `failed`.
 */
export async function handleArchiveSource(
  payload: unknown,
  ctx: JobContext,
  deps: { fetch?: ArchiveFetch } = {},
): Promise<void> {
  if (!isPayload(payload)) return;
  const row = ctx.db
    .select({ url: sources.url, status: sources.archiveStatus })
    .from(sources)
    .where(eq(sources.id, payload.sourceId))
    .get();
  if (row?.status !== "pending") return;
  if (!archiveEnabled()) {
    setArchive(ctx.db, payload.sourceId, { archiveStatus: "skipped" });
    return;
  }
  try {
    const archivedUrl = await requestArchive(row.url, { fetch: deps.fetch, signal: ctx.signal });
    if (ctx.signal.aborted) return;
    setArchive(ctx.db, payload.sourceId, { archiveStatus: "done", archivedUrl });
  } catch (err) {
    if (ctx.job.attempts >= ARCHIVE_MAX_ATTEMPTS) {
      setArchive(ctx.db, payload.sourceId, { archiveStatus: "failed" });
      return;
    }
    throw err;
  }
}

function setArchive(
  db: AppDb,
  sourceId: string,
  set: { archiveStatus: "done" | "failed" | "skipped"; archivedUrl?: string },
) {
  db.update(sources).set(set).where(eq(sources.id, sourceId)).run();
}
