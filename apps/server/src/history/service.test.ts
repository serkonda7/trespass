import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { failure } from "../authz/test-errors";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { events, jobs, sources } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { createLocation, setLocationGrant } from "../locations/service";
import { searchLocations } from "../search/query";
import { getLocationTimeline } from "../visits/service";
import {
  approveHistory,
  createHistory,
  deleteHistory,
  getHistory,
  listHistory,
  updateHistory,
} from "./service";

const admin = ctxFor("admin", "admin");
const owner = ctxFor("owner", "member");
const member = ctxFor("member", "member");
const guest = ctxFor("guest", "guest");
let db: AppDb;
let locationId: string;

beforeEach(() => {
  db = createTestDb();
  seed(db, {
    users: [
      { id: "admin", role: "admin" },
      { id: "owner", role: "member" },
      { id: "member", role: "member" },
      { id: "guest", role: "guest" },
    ],
  });
  locationId = createLocation(db, owner, {
    name: "Alte Heilstätte",
    categoryId: "cat-industry",
    point: { lat: 51.1, lon: 7.1 },
    visibility: "friends",
    friendsLevel: "view",
  }).id;
});

const entry = (overrides: Record<string, unknown> = {}) =>
  createHistory(db, owner, {
    locationId,
    datePrecision: "year",
    dateFrom: "1923",
    text: "Eröffnet als Lungenheilanstalt",
    sources: [{ url: "https://example.org/chronik", title: "Chronik" }],
    ...overrides,
  });

describe("history permissions", () => {
  test("viewers read approved entries; only editors write", () => {
    entry();
    expect(listHistory(db, member, locationId)).toHaveLength(1);
    expect(listHistory(db, guest, locationId)[0]!.permissions.canEdit).toBe(false);
    expect(
      failure(() =>
        createHistory(db, member, {
          locationId,
          datePrecision: "year",
          dateFrom: "1950",
          text: "x",
        }),
      ),
    ).toEqual({ status: 403, code: "HISTORY_FORBIDDEN" });
    setLocationGrant(db, owner, {
      locationId,
      principalKind: "user",
      principalId: "member",
      level: "edit",
    });
    expect(
      createHistory(db, member, { locationId, datePrecision: "year", dateFrom: "1950", text: "x" })
        .id,
    ).toBeString();
  });

  test("an invisible location answers 404, never 403", () => {
    const hidden = createLocation(db, owner, {
      name: "Privat",
      categoryId: "cat-industry",
      point: { lat: 50, lon: 8 },
    }).id;
    const { id } = createHistory(db, owner, {
      locationId: hidden,
      datePrecision: "year",
      dateFrom: "1900",
      text: "geheim",
    });
    expect(failure(() => listHistory(db, member, hidden))).toEqual({
      status: 404,
      code: "LOCATION_NOT_FOUND",
    });
    expect(failure(() => getHistory(db, member, id))).toEqual({
      status: 404,
      code: "HISTORY_NOT_FOUND",
    });
    expect(failure(() => deleteHistory(db, member, id))).toEqual({
      status: 404,
      code: "HISTORY_NOT_FOUND",
    });
  });

  test("drafts are visible only at edit and become searchable on approval", () => {
    const { id, version } = entry({ status: "draft", text: "Brandstiftung im Ostflügel" });
    expect(listHistory(db, member, locationId)).toEqual([]);
    expect(failure(() => getHistory(db, member, id))?.code).toBe("HISTORY_NOT_FOUND");
    expect(listHistory(db, owner, locationId)[0]!.permissions.canApprove).toBe(true);
    expect(searchLocations(db, admin, { q: "brandstiftung" }).rows).toHaveLength(0);
    approveHistory(db, owner, { id, version });
    expect(listHistory(db, member, locationId)).toHaveLength(1);
    expect(searchLocations(db, member, { q: "brandstiftung" }).rows).toHaveLength(1);
  });
});

describe("history entries", () => {
  test("dates are checked against the precision and decades normalized", () => {
    expect(failure(() => entry({ datePrecision: "day", dateFrom: "1923" }))).toEqual({
      status: 422,
      code: "HISTORY_DATE_INVALID",
    });
    expect(failure(() => entry({ dateFrom: "1930", dateTo: "1920" }))?.code).toBe(
      "HISTORY_DATE_INVALID",
    );
    const { id } = entry({ datePrecision: "decade", dateFrom: "1927" });
    expect(getHistory(db, owner, id).dateFrom).toBe("1920");
  });

  test("sources: http(s) only, archived on save, kept on update", () => {
    expect(failure(() => entry({ sources: [{ url: "javascript:alert(1)" }] }))?.code).toBe(
      "SOURCE_URL_INVALID",
    );
    const { id, version } = entry();
    const [src] = getHistory(db, owner, id).sources;
    expect(src!.archiveStatus).toBe("pending");
    expect(db.select().from(jobs).where(eq(jobs.kind, "sources.archive")).all()).toHaveLength(1);
    db.update(sources)
      .set({ archiveStatus: "done", archivedUrl: "https://web.archive.org/web/2026/x" })
      .where(eq(sources.id, src!.id))
      .run();
    updateHistory(db, owner, {
      id,
      version,
      sources: [
        { id: src!.id, url: src!.url, title: "Neu" },
        { url: "https://example.org/zweite" },
      ],
    });
    const after = getHistory(db, owner, id).sources;
    expect(after.map((s) => s.title)).toEqual(["Neu", null]);
    expect(after[0]!.archivedUrl).toBe("https://web.archive.org/web/2026/x");
    expect(db.select().from(jobs).where(eq(jobs.kind, "sources.archive")).all()).toHaveLength(2);
  });

  test("optimistic locking and an audit log without the text", () => {
    const { id, version } = entry();
    updateHistory(db, owner, { id, version, text: "Neu" });
    expect(failure(() => updateHistory(db, owner, { id, version, text: "Alt" }))).toEqual({
      status: 409,
      code: "VERSION_CONFLICT",
    });
    const diffs = JSON.stringify(
      db
        .select()
        .from(events)
        .all()
        .map((e) => e.diff),
    );
    expect(diffs).not.toContain("Lungenheilanstalt");
    expect(diffs).not.toContain("example.org");
  });

  test("approved entries appear in the location timeline and in search", () => {
    entry();
    const timeline = getLocationTimeline(db, member, locationId);
    expect(timeline.some((e) => e.kind === "history")).toBe(true);
    expect(searchLocations(db, member, { q: "lungenheil" }).rows.map((r) => r.id)).toEqual([
      locationId,
    ]);
  });

  test("delete removes the entry from search", () => {
    const { id } = entry();
    deleteHistory(db, admin, id);
    expect(searchLocations(db, member, { q: "lungenheil" }).rows).toHaveLength(0);
  });
});
