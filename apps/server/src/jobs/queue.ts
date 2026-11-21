// `jobs` table as a queue (DESIGN §7). Row states:
//   pending  done_at NULL, lease NULL/expired    running  done_at NULL, lease live
//   done     done_at set, no error               dead     done_at + last_error
// Claim = one UPDATE … RETURNING. `attempts` doubles as the lease token, so a
// worker whose lease was re-claimed can't finish or fail the row.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { type Job, jobs } from "../db/schema";

export type EnqueueOptions = { runAt?: Date; delayMs?: number };

export function enqueueJob(
  db: DbOrTx,
  kind: string,
  payload: unknown = {},
  opts: EnqueueOptions = {},
) {
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
  return db
    .insert(jobs)
    .values({ kind, payload: payload ?? {}, runAt })
    .returning({ id: jobs.id })
    .get().id;
}

/** True when a not-yet-done job of this kind exists (for recurring jobs). */
export function hasPendingJob(db: DbOrTx, kind: string): boolean {
  return !!db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), isNull(jobs.doneAt)))
    .get();
}

type RawJob = {
  id: string;
  kind: string;
  payload: string;
  run_at: number;
  attempts: number;
  locked_until: number | null;
  done_at: number | null;
  last_error: string | null;
};

/**
 * Atomically leases the next due job whose kind is in `kinds` (the ones this
 * worker can run) and whose attempts are below its limit. Returns null when
 * nothing is due.
 */
export function claimNextJob(
  db: DbOrTx,
  opts: { now: number; lockMs: number; kinds: readonly string[] },
): Job | null {
  if (opts.kinds.length === 0) return null;
  const marks = opts.kinds.map(() => "?").join(",");
  const client = clientOf(db);
  const r = client
    .query(
      `UPDATE jobs SET locked_until = ?, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
         WHERE done_at IS NULL AND run_at <= ? AND (locked_until IS NULL OR locked_until <= ?)
           AND kind IN (${marks})
         ORDER BY run_at, id LIMIT 1)
       RETURNING *`,
    )
    .get(opts.now + opts.lockMs, opts.now, opts.now, ...opts.kinds) as RawJob | null;
  return r ? fromRaw(r) : null;
}

function clientOf(db: DbOrTx): import("bun:sqlite").Database {
  // Both AppDb and a transaction expose the bun:sqlite handle as `session.client`;
  // AppDb also as `$client`.
  const d = db as unknown as {
    $client?: import("bun:sqlite").Database;
    session?: { client: import("bun:sqlite").Database };
  };
  const c = d.$client ?? d.session?.client;
  if (!c) throw new Error("jobs: no sqlite client");
  return c;
}

function fromRaw(r: RawJob): Job {
  return {
    id: r.id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    runAt: new Date(r.run_at),
    attempts: r.attempts,
    lockedUntil: r.locked_until === null ? null : new Date(r.locked_until),
    doneAt: r.done_at === null ? null : new Date(r.done_at),
    lastError: r.last_error,
  };
}

/** The lease is still ours: not done, and nobody re-claimed it since (attempts unchanged). */
const leased = (job: Pick<Job, "id" | "attempts">) =>
  and(eq(jobs.id, job.id), eq(jobs.attempts, job.attempts), isNull(jobs.doneAt));

/** Extends a running job's lease. False when the lease was lost. */
export function heartbeat(db: DbOrTx, job: Job, until: number): boolean {
  const r = db
    .update(jobs)
    .set({ lockedUntil: new Date(until) })
    .where(leased(job))
    .returning({ id: jobs.id })
    .get();
  return !!r;
}

export function completeJob(db: DbOrTx, job: Job, now: number): boolean {
  const r = db
    .update(jobs)
    .set({ doneAt: new Date(now), lockedUntil: null, lastError: null })
    .where(leased(job))
    .returning({ id: jobs.id })
    .get();
  return !!r;
}

/** Schedules a retry at `retryAt`, or marks the job dead when `retryAt` is null. */
export function failJob(
  db: DbOrTx,
  job: Job,
  error: string,
  now: number,
  retryAt: number | null,
): boolean {
  const r = db
    .update(jobs)
    .set(
      retryAt === null
        ? { doneAt: new Date(now), lockedUntil: null, lastError: error }
        : { runAt: new Date(retryAt), lockedUntil: null, lastError: error },
    )
    .where(leased(job))
    .returning({ id: jobs.id })
    .get();
  return !!r;
}

/** At start: release a crashed process's leases. The attempt still counts, so crash loops end dead. */
export function releaseStaleLeases(db: DbOrTx): number {
  const r = db
    .update(jobs)
    .set({ lockedUntil: null })
    .where(and(isNull(jobs.doneAt), isNotNull(jobs.lockedUntil)))
    .returning({ id: jobs.id })
    .all();
  return r.length;
}

/** Exponential backoff: base, 2·base, 4·base … capped. */
export function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** Deletes successfully finished jobs that finished before `before` (dead ones are kept). */
export function pruneJobs(db: DbOrTx, before: Date) {
  const client = clientOf(db);
  client
    .query("DELETE FROM jobs WHERE done_at IS NOT NULL AND done_at < ? AND last_error IS NULL")
    .run(before.getTime());
}
