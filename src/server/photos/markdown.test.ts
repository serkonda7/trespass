import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ctxFor, seed } from "../authz/test-fixtures";
import { visits } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { renderJournalMarkdown } from "../markdown";
import { getVisit } from "../visits/service";
import { photoEmbedIds, resolvePhotoEmbeds } from "./service";
import { insertPhoto } from "./test-helpers";

const OWNER = "owner";
const VIEWER = "viewer";
const LOC = "loc";

function setup() {
  const db = createTestDb();
  seed(db, {
    users: [
      { id: OWNER, role: "member" },
      { id: VIEWER, role: "member" },
    ],
    locations: [
      {
        id: LOC,
        ownerId: OWNER,
        lat: 51,
        lon: 7,
        pubLat: 51,
        pubLon: 7,
        tz: "Etc/UTC",
        visibility: "friends",
        friendsLevel: "view",
      },
    ],
  });
  db.insert(visits)
    .values({
      id: "visit",
      locationId: LOC,
      authorId: OWNER,
      visitedOn: "2026-11-18",
      journalMd: "",
    })
    .run();
  return db;
}

describe("journal photo embeds", () => {
  test("batch SQL resolves only visible, ready photos", () => {
    const db = setup();
    const visible = insertPhoto(db, {
      id: "visible",
      uploaderId: OWNER,
      locationId: LOC,
      status: "ready",
    });
    const processing = insertPhoto(db, {
      id: "processing",
      uploaderId: OWNER,
      locationId: LOC,
      status: "processing",
      sha256: "d".repeat(64),
    });
    insertPhoto(db, {
      id: "hidden",
      uploaderId: OWNER,
      status: "ready",
      sha256: "e".repeat(64),
    });
    const ids = ["visible", "processing", "hidden", "nope"];
    expect(
      photoEmbedIds("![a](photo:visible) und ![b](photo:hidden) und ![c](photo:visible)"),
    ).toEqual(["visible", "hidden"]);
    const urls = resolvePhotoEmbeds(db, ctxFor(VIEWER, "member"), ids);
    expect(urls.get("visible")).toBe("/files/visible?size=1600");
    expect(urls.has("processing")).toBe(false);
    expect(urls.has("hidden")).toBe(false);
    expect(urls.has("nope")).toBe(false);
    expect(visible.status).toBe("ready");
    expect(processing.status).toBe("processing");
  });

  test("a visit's journalHtml only embeds photos the viewer can see", () => {
    const db = setup();
    insertPhoto(db, { id: "ready", uploaderId: OWNER, locationId: LOC, status: "ready" });
    insertPhoto(db, {
      id: "secret",
      uploaderId: OWNER,
      status: "ready",
      sha256: "f".repeat(64),
    });
    db.update(visits)
      .set({ journalMd: "Vor ![Dach](photo:ready) nach ![X](photo:secret) Ende ![Y](photo:nope)" })
      .where(eq(visits.id, "visit"))
      .run();
    const visit = getVisit(db, ctxFor(VIEWER, "member"), "visit");
    expect(visit.journalHtml).toContain("/files/ready?size=1600");
    expect(visit.journalHtml).not.toContain("secret");
    expect(visit.journalHtml).not.toContain("nope");
    expect(visit.journalHtml).toContain("Vor");
    expect(visit.journalHtml).toContain("Ende");

    const direct = renderJournalMarkdown("![](photo:ready)", {
      resolvePhoto: (id) => resolvePhotoEmbeds(db, ctxFor(VIEWER, "member"), [id]).get(id) ?? null,
    });
    expect(direct).toContain("/files/ready?size=1600");
  });
});
