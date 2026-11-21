// Export contents per role (DESIGN §3.4 rules 4/5/6, §3.5, §13): what goes in,
// what never does, and byte-identical output when the exact point moves.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { recordEvent } from "../audit";
import { ctxFor, seed } from "../authz/test-fixtures";
import { createComment } from "../comments/service";
import { accounts, invites, passkeys, sessions, users, verifications, visits } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { createEquipment } from "../equipment/service";
import { createHistory } from "../history/service";
import { insertPhoto, tempPhotoStore } from "../photos/test-helpers";
import { createTrip } from "../trips/service";
import { PATHS } from "./build";
import type { ReadArchive } from "./test-helpers";
import { exportToMemory } from "./test-helpers";

const SECRETS = {
  password: "SENTINEL-password-hash-7f3a",
  accessToken: "SENTINEL-access-token-91c2",
  refreshToken: "SENTINEL-refresh-token-0b8e",
  idToken: "SENTINEL-id-token-55d1",
  sessionToken: "SENTINEL-session-token-c4a9",
  sessionIp: "203.0.113.77",
  sessionAgent: "SENTINEL-user-agent-2e6f",
  passkeyPublicKey: "SENTINEL-passkey-public-key-a1b7",
  passkeyCredential: "SENTINEL-passkey-credential-3d90",
  verificationValue: "SENTINEL-verification-value-8c21",
  verificationIdentifier: "SENTINEL-verification-identifier-6e44",
  inviteHash: "SENTINEL-invite-token-hash-fa12",
  authEmail: "sentinel-auth-alias@users.invalid",
  jobPayload: "SENTINEL-job-payload-aa11",
};

const admin = ctxFor("adm", "admin");
const anna = ctxFor("ann", "member");
const guest = ctxFor("gue", "guest");
const decode = new TextDecoder();

const ORIGINAL = new TextEncoder().encode("SENTINEL-anna-original-photo-bytes-1234");
const OTHER_ORIGINAL = new TextEncoder().encode("SENTINEL-ben-original-photo-bytes-9876");
const DERIVED = new TextEncoder().encode("metadata-free-webp-derivative");

async function world() {
  const db = createTestDb();
  const store = tempPhotoStore();
  seed(db, {
    users: [
      { id: "adm", role: "admin" },
      { id: "ann", role: "member" },
      { id: "ben", role: "member" },
      { id: "gue", role: "guest" },
    ],
    locations: [
      {
        id: "loc-friends",
        ownerId: "adm",
        name: "Freundesort",
        visibility: "friends",
        friendsLevel: "view",
        lat: 51.1,
        lon: 7.1,
        pubLat: 51.2,
        pubLon: 7.2,
        fuzzRadiusM: 1500,
        accessNotes: "SENTINEL-access-notes",
        dangerNotes: "SENTINEL-danger-notes",
        parking: [{ lat: 51.1001, lon: 7.1001 }],
        geomArea: {
          type: "Polygon",
          coordinates: [
            [
              [7.1, 51.1],
              [7.11, 51.1],
              [7.11, 51.11],
              [7.1, 51.1],
            ],
          ],
        },
      },
      {
        id: "loc-precise",
        ownerId: "adm",
        name: "Vertrautenort",
        visibility: "private",
        lat: 52.1,
        lon: 8.1,
        pubLat: 52.2,
        pubLon: 8.2,
        accessNotes: "SENTINEL-precise-notes",
      },
      {
        id: "loc-anna",
        ownerId: "ann",
        name: "Annas Ort",
        visibility: "private",
        lat: 53.1,
        lon: 9.1,
        pubLat: 53.2,
        pubLon: 9.2,
      },
      {
        id: "loc-hidden",
        ownerId: "ben",
        name: "Bens Geheimort",
        visibility: "private",
        lat: 54.1,
        lon: 10.1,
        pubLat: 54.2,
        pubLon: 10.2,
        dangerNotes: "SENTINEL-hidden-notes",
      },
    ],
    grants: [
      { locationId: "loc-precise", principalKind: "user", principalId: "ann", level: "precise" },
      { locationId: "loc-hidden", principalKind: "user", principalId: "ann", level: "view" },
    ],
  });
  db.insert(visits)
    .values([
      {
        id: "vis-1",
        locationId: "loc-friends",
        authorId: "ben",
        visitedOn: "2026-10-01",
        conditions: { access: "open", hazards: ["SENTINEL-hazard"] },
        journalMd: "SENTINEL-ben-journal-text",
      },
      {
        id: "vis-2",
        locationId: "loc-precise",
        authorId: "ann",
        visitedOn: "2026-10-02",
        journalMd: "SENTINEL-anna-journal-text",
      },
    ])
    .run();

  const originalSha = "a".repeat(64);
  const otherSha = "b".repeat(64);
  store.store.ensureBlobSync(originalSha, ORIGINAL);
  store.store.ensureBlobSync(otherSha, OTHER_ORIGINAL);
  await store.store.putDerived(originalSha, 2560, DERIVED);
  await store.store.putDerived(otherSha, 2560, DERIVED);
  insertPhoto(db, {
    id: "ph-own",
    uploaderId: "ann",
    sha256: originalSha,
    mime: "image/jpeg",
    locationId: "loc-friends",
  });
  insertPhoto(db, {
    id: "ph-other",
    uploaderId: "ben",
    sha256: otherSha,
    mime: "image/jpeg",
    locationId: "loc-friends",
  });
  insertPhoto(db, {
    id: "ph-waiting",
    uploaderId: "ben",
    sha256: "c".repeat(64),
    status: "processing",
    locationId: "loc-friends",
  });

  // Secrets in all auth tables plus a job payload: none may appear in a ZIP.
  db.insert(accounts)
    .values({
      accountId: "ann",
      providerId: "credential",
      userId: "ann",
      password: SECRETS.password,
      accessToken: SECRETS.accessToken,
      refreshToken: SECRETS.refreshToken,
      idToken: SECRETS.idToken,
    })
    .run();
  db.insert(sessions)
    .values({
      token: SECRETS.sessionToken,
      userId: "ann",
      expiresAt: new Date(Date.now() + 3_600_000),
      ipAddress: SECRETS.sessionIp,
      userAgent: SECRETS.sessionAgent,
    })
    .run();
  db.insert(passkeys)
    .values({
      publicKey: SECRETS.passkeyPublicKey,
      userId: "ann",
      credentialID: SECRETS.passkeyCredential,
      counter: 1,
      deviceType: "singleDevice",
      backedUp: false,
    })
    .run();
  db.insert(verifications)
    .values({
      identifier: SECRETS.verificationIdentifier,
      value: SECRETS.verificationValue,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .run();
  db.insert(invites)
    .values({
      role: "member",
      tokenHash: SECRETS.inviteHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .run();
  db.update(users).set({ authEmail: SECRETS.authEmail }).where(eq(users.id, "ben")).run();
  db.insert(users)
    .values({
      id: "unsorted",
      username: "unsorted",
      displayName: SECRETS.jobPayload,
      authEmail: "unsorted@users.invalid",
      role: "guest",
    })
    .run();
  recordEvent(db, { actorId: "adm", action: "settings.updated", diff: { note: "ok" } });

  return { db, store };
}

function assertNoSecrets(a: ReadArchive) {
  const haystacks = [Buffer.from(a.raw), ...Object.values(a.files).map((b) => Buffer.from(b))];
  for (const [k, v] of Object.entries(SECRETS))
    for (const h of haystacks) expect({ k, found: h.includes(v) }).toEqual({ k, found: false });
}

describe("export contents", () => {
  test("admin archive is a valid ZIP with the documented files", async () => {
    const w = await world();
    const a = await exportToMemory(w.db, admin, w.store.store);
    expect(a.names).toEqual(
      [
        PATHS.geojson,
        PATHS.manifest,
        PATHS.categories,
        PATHS.locations,
        PATHS.tags,
        PATHS.visits,
        PATHS.photos,
        PATHS.grants,
        PATHS.users,
        PATHS.history,
        PATHS.comments,
        PATHS.trips,
        PATHS.equipment,
        PATHS.packTemplates,
        "journals/2026-10-01-freundesort-vis-1.md",
        "journals/2026-10-02-vertrautenort-vis-2.md",
        "photos/ph-own.jpg",
        "photos/ph-other.jpg",
      ].sort(),
    );
    const manifest = a.json<{
      formatVersion: number;
      scope: string;
      counts: Record<string, number>;
    }>(PATHS.manifest);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.scope).toBe("all");
    expect(manifest.counts).toMatchObject({
      locations: 4,
      visits: 2,
      journals: 2,
      photos: 3,
      photoFiles: 2,
      skippedPhotos: 1,
      grants: 2,
    });
    expect(a.json<unknown[]>(PATHS.locations)).toHaveLength(4);
    expect(a.json<unknown[]>(PATHS.categories)).toHaveLength(10);
    expect(a.json<unknown[]>(PATHS.users)).toEqual([
      { id: "adm", displayName: "adm" },
      { id: "ann", displayName: "ann" },
      { id: "ben", displayName: "ben" },
    ]);
    assertNoSecrets(a);
    w.store.cleanup();
  });

  test("admin sees exact coordinates and the outline; a view-level member sees only the fuzz", async () => {
    const w = await world();
    const a = await exportToMemory(w.db, admin, w.store.store);
    const adminGeo = a.json<{
      features: {
        geometry: { type: string; coordinates?: number[] };
        properties: { id: string };
      }[];
    }>(PATHS.geojson);
    expect(adminGeo.features).toHaveLength(5); // 4 points + 1 outline
    const friendsPoint = adminGeo.features.find((f) => f.properties.id === "loc-friends");
    expect(friendsPoint?.geometry).toEqual({ type: "Point", coordinates: [7.1, 51.1] });
    expect(adminGeo.features.some((f) => f.geometry.type === "Polygon")).toBe(true);

    const m = await exportToMemory(w.db, anna, w.store.store);
    const geo = m.json<{
      features: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[];
    }>(PATHS.geojson);
    // loc-friends (view), loc-precise (granted), loc-anna (own), loc-hidden (view grant).
    expect(geo.features.map((f) => f.properties.id).sort()).toEqual([
      "loc-anna",
      "loc-friends",
      "loc-hidden",
      "loc-precise",
    ]);
    const friends = geo.features.find((f) => f.properties.id === "loc-friends");
    expect(friends?.geometry.coordinates).toEqual([7.2, 51.2]);
    expect(friends?.properties).not.toHaveProperty("fuzzRadiusM");
    expect(friends?.properties).not.toHaveProperty("geomArea");
    expect(friends?.properties).not.toHaveProperty("parking");
    expect(friends?.properties).not.toHaveProperty("accessNotes");
    expect(friends?.properties).not.toHaveProperty("point");
    const exact = geo.features.find((f) => f.properties.id === "loc-precise");
    expect(exact?.geometry.coordinates).toEqual([8.1, 52.1]);
    // Grants of managed locations only; Anna manages loc-anna, not loc-hidden.
    const grants = m.json<{ locationId: string }[]>(PATHS.grants);
    expect(grants).toEqual([]);
    assertNoSecrets(m);
    w.store.cleanup();
  });

  test("a member archive contains no other user's original or precise data", async () => {
    const w = await world();
    const a = await exportToMemory(w.db, anna, w.store.store);
    // Own original + other user's derivative; no other user's original bytes.
    const own = a.files["photos/ph-own.jpg"];
    const other = a.files["photos/ph-other.webp"];
    expect(Buffer.from(own ?? new Uint8Array())).toEqual(Buffer.from(ORIGINAL));
    expect(Buffer.from(other ?? new Uint8Array())).toEqual(Buffer.from(DERIVED));
    expect(a.files["photos/ph-other.jpg"]).toBeUndefined();
    for (const f of Object.values(a.files))
      expect(Buffer.from(f).includes(Buffer.from(OTHER_ORIGINAL))).toBe(false);

    const locations = a.json<{ id: string; accessNotes?: string; geomArea?: unknown }[]>(
      PATHS.locations,
    );
    const friends = locations.find((l) => l.id === "loc-friends");
    expect(friends?.accessNotes).toBeUndefined();
    expect(friends?.geomArea).toBeUndefined();
    const photos = a.json<{ id: string; gps?: unknown; originalUrl?: string }[]>(PATHS.photos);
    expect(photos.find((p) => p.id === "ph-own")?.gps).toBeUndefined();
    // The uploader may see the original URL of their own photo, but not of others'.
    expect(photos.find((p) => p.id === "ph-own")?.originalUrl).toBeDefined();
    expect(photos.find((p) => p.id === "ph-other")?.originalUrl).toBeUndefined();
    assertNoSecrets(a);
    w.store.cleanup();
  });

  test("v1.1 data follows the same visibility rules", async () => {
    const w = await world();
    const ben = ctxFor("ben", "member");
    createHistory(w.db, admin, {
      locationId: "loc-hidden",
      datePrecision: "year",
      dateFrom: "1950",
      text: "SENTINEL-draft-history",
      status: "draft",
    });
    createHistory(w.db, admin, {
      locationId: "loc-hidden",
      datePrecision: "year",
      dateFrom: "1960",
      text: "Bekannte Geschichte",
    });
    seed(w.db, {
      skipCategories: true,
      locations: [{ id: "loc-ben-only", ownerId: "ben", name: "Nur Ben" }],
    });
    createComment(w.db, ben, {
      target: { kind: "location", id: "loc-ben-only" },
      bodyMd: "SENTINEL-invisible-comment",
    });
    createComment(w.db, ben, { target: { kind: "location", id: "loc-friends" }, bodyMd: "Hallo" });
    createTrip(w.db, ben, { title: "SENTINEL-ben-trip", locationIds: ["loc-ben-only"] });
    createTrip(w.db, admin, {
      title: "Gemeinsam",
      people: [{ userId: "ann" }],
      locationIds: ["loc-friends", "loc-ben-only"],
    });
    createEquipment(w.db, ben, { name: "SENTINEL-ben-gear" });
    createEquipment(w.db, anna, { name: "Annas Lampe" });

    const a = await exportToMemory(w.db, anna, w.store.store);
    const text = Object.values(a.files)
      .map((f) => decode.decode(f))
      .join("\n");
    for (const hidden of [
      "SENTINEL-draft-history",
      "SENTINEL-invisible-comment",
      "SENTINEL-ben-trip",
      "SENTINEL-ben-gear",
      "Nur Ben",
    ])
      expect({ hidden, found: text.includes(hidden) }).toEqual({ hidden, found: false });
    expect(a.json<{ text: string }[]>(PATHS.history).map((h) => h.text)).toEqual([
      "Bekannte Geschichte",
    ]);
    expect(a.json<unknown[]>(PATHS.comments)).toHaveLength(1);
    const trips = a.json<
      { title: string; stops: { location: { id: string; point: { lat: number } } }[] }[]
    >(PATHS.trips);
    expect(trips.map((t) => t.title)).toEqual(["Gemeinsam"]);
    // Only the visible stop, at the fuzzed point.
    expect(trips[0]!.stops.map((s) => [s.location.id, s.location.point.lat])).toEqual([
      ["loc-friends", 51.2],
    ]);
    expect(a.json<{ name: string }[]>(PATHS.equipment).map((e) => e.name)).toEqual(["Annas Lampe"]);
    const manifest = a.json<{ counts: Record<string, number> }>(PATHS.manifest);
    expect(manifest.counts).toMatchObject({ history: 1, comments: 1, trips: 1, equipment: 1 });
    assertNoSecrets(a);
    w.store.cleanup();
  });

  test("guest scope has no export", async () => {
    const w = await world();
    await expect(exportToMemory(w.db, guest, w.store.store)).rejects.toThrow();
    w.store.cleanup();
  });

  test("journals: raw markdown only where the exporter may edit", async () => {
    const w = await world();
    const a = await exportToMemory(w.db, anna, w.store.store);
    const own = decode.decode(a.files["journals/2026-10-02-vertrautenort-vis-2.md"]!);
    expect(own).toContain("SENTINEL-anna-journal-text");
    const other = decode.decode(a.files["journals/2026-10-01-freundesort-vis-1.md"]!);
    expect(other).toContain('date: "2026-10-01"');
    expect(other).not.toContain("SENTINEL-ben-journal-text");
    w.store.cleanup();
  });
});

describe("metamorphic privacy", () => {
  test("moving only the exact point leaves every non-manifest byte unchanged", async () => {
    const w = await world();
    const before = await exportToMemory(w.db, anna, w.store.store);
    // Raw SQL, like authz/metamorphic.ts: no version/timestamp side effects.
    w.db.$client
      .query("UPDATE locations SET lat = ?, lon = ? WHERE id = ?")
      .run(60.12345, 20.54321, "loc-friends");
    const after = await exportToMemory(w.db, anna, w.store.store);
    expect(after.names).toEqual(before.names);
    for (const name of before.names) {
      if (name === PATHS.manifest) continue;
      expect(Buffer.from(after.files[name]!)).toEqual(Buffer.from(before.files[name]!));
    }
    const m1 = before.json<{ exportedAt: string }>(PATHS.manifest);
    const m2 = after.json<{ exportedAt: string }>(PATHS.manifest);
    expect(m2.exportedAt).toEqual(m1.exportedAt);
    expect(
      Buffer.from(after.files[PATHS.manifest]!).equals(Buffer.from(before.files[PATHS.manifest]!)),
    ).toBe(true);
    // Even with a different injected time, only the manifest changes.
    const later = await exportToMemory(w.db, anna, w.store.store, {
      now: new Date("2026-11-16T14:03:00Z"),
    });
    for (const name of before.names) {
      if (name === PATHS.manifest) continue;
      expect(Buffer.from(later.files[name]!)).toEqual(Buffer.from(before.files[name]!));
    }
    expect(later.json(PATHS.manifest).exportedAt).not.toEqual(m1.exportedAt);
    w.store.cleanup();
  });
});
