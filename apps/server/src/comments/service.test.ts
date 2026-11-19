import { beforeEach, describe, expect, test } from "bun:test";
import { failure } from "../authz/test-errors";
import { ctxFor, seed } from "../authz/test-fixtures";
import type { AppDb } from "../db/client";
import { createTestDb } from "../db/test-db";
import { createLocation, deleteLocation, setVisibility } from "../locations/service";
import { insertPhoto } from "../photos/test-helpers";
import { createVisit } from "../visits/service";
import { createComment, deleteComment, listComments, updateComment } from "./service";

const admin = ctxFor("admin", "admin");
const owner = ctxFor("owner", "member");
const member = ctxFor("member", "member");
const other = ctxFor("other", "member");
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
      { id: "other", role: "member" },
      { id: "guest", role: "guest" },
    ],
  });
  locationId = createLocation(db, owner, {
    name: "Bahnhof",
    categoryId: "cat-industry",
    point: { lat: 51, lon: 7 },
    visibility: "friends",
    friendsLevel: "contribute",
  }).id;
});

const onLocation = {
  kind: "location" as const,
  get id() {
    return locationId;
  },
};

describe("comments", () => {
  test("threads on a visible location; guests read but never write", () => {
    const root = createComment(db, member, { target: onLocation, bodyMd: "Wart ihr **drin**?" });
    const reply = createComment(db, owner, {
      target: onLocation,
      parentId: root.id,
      bodyMd: "Ja, Seiteneingang",
    });
    expect(reply.parentId).toBe(root.id);
    const seen = listComments(db, guest, { target: onLocation });
    expect(seen.map((c) => c.id)).toEqual([root.id, reply.id]);
    expect(seen[0]!.bodyHtml).toContain("<strong>drin</strong>");
    expect(seen[0]!.bodyMd).toBeUndefined();
    expect(seen[0]!.permissions).toEqual({ canEdit: false, canDelete: false, canReply: false });
    expect(failure(() => createComment(db, guest, { target: onLocation, bodyMd: "Hi" }))).toEqual({
      status: 403,
      code: "COMMENT_FORBIDDEN",
    });
  });

  test("an invisible target is a 404 for both reading and writing", () => {
    setVisibility(db, owner, {
      id: locationId,
      visibility: "private",
      friendsLevel: "view",
      version: 1,
    });
    expect(failure(() => listComments(db, member, { target: onLocation }))).toEqual({
      status: 404,
      code: "LOCATION_NOT_FOUND",
    });
    expect(failure(() => createComment(db, member, { target: onLocation, bodyMd: "x" }))).toEqual({
      status: 404,
      code: "LOCATION_NOT_FOUND",
    });
    const c = createComment(db, owner, { target: onLocation, bodyMd: "privat" });
    expect(failure(() => deleteComment(db, member, c.id))).toEqual({
      status: 404,
      code: "COMMENT_NOT_FOUND",
    });
  });

  test("authors edit their own; authors and admins delete (soft)", () => {
    const c = createComment(db, member, { target: onLocation, bodyMd: "erste Version" });
    expect(failure(() => updateComment(db, other, { id: c.id, bodyMd: "x" }))?.code).toBe(
      "COMMENT_FORBIDDEN",
    );
    expect(failure(() => updateComment(db, admin, { id: c.id, bodyMd: "x" }))?.code).toBe(
      "COMMENT_FORBIDDEN",
    );
    const edited = updateComment(db, member, { id: c.id, bodyMd: "zweite Version" });
    expect(edited.editedAt).not.toBeNull();
    expect(failure(() => deleteComment(db, other, c.id))?.code).toBe("COMMENT_FORBIDDEN");
    const reply = createComment(db, other, { target: onLocation, parentId: c.id, bodyMd: "!" });
    deleteComment(db, admin, c.id);
    const list = listComments(db, member, { target: onLocation });
    expect(list[0]).toMatchObject({ id: c.id, deleted: true, bodyHtml: "" });
    expect(list[1]!.id).toBe(reply.id);
    expect(failure(() => updateComment(db, member, { id: c.id, bodyMd: "zurück" }))?.code).toBe(
      "COMMENT_FORBIDDEN",
    );
  });

  test("a reply must belong to the same target", () => {
    const other = createLocation(db, owner, {
      name: "Zweiter",
      categoryId: "cat-industry",
      point: { lat: 52, lon: 8 },
      visibility: "friends",
    }).id;
    const c = createComment(db, member, { target: onLocation, bodyMd: "a" });
    expect(
      failure(() =>
        createComment(db, member, {
          target: { kind: "location", id: other },
          parentId: c.id,
          bodyMd: "b",
        }),
      ),
    ).toEqual({ status: 422, code: "COMMENT_PARENT_INVALID" });
  });

  test("visit and photo comments follow their target; markup is sanitized", () => {
    const visit = createVisit(db, member, { locationId });
    const photo = insertPhoto(db, { uploaderId: "member", locationId });
    const v = createComment(db, owner, {
      target: { kind: "visit", id: visit.id },
      bodyMd: "<script>alert(1)</script>[x](javascript:alert(1))",
    });
    expect(v.bodyHtml).not.toContain("<script");
    expect(v.bodyHtml).not.toContain("javascript:");
    createComment(db, owner, { target: { kind: "photo", id: photo.id }, bodyMd: "Schön" });
    expect(listComments(db, guest, { target: { kind: "photo", id: photo.id } })).toHaveLength(1);
    // The photo's uploader keeps it after the location goes; a stranger does not.
    setVisibility(db, owner, {
      id: locationId,
      visibility: "private",
      friendsLevel: "view",
      version: 1,
    });
    expect(listComments(db, member, { target: { kind: "visit", id: visit.id } })).toHaveLength(1);
    expect(
      failure(() => listComments(db, other, { target: { kind: "photo", id: photo.id } })),
    ).toEqual({ status: 404, code: "PHOTO_NOT_FOUND" });
  });

  test("deleting the target deletes its comments", () => {
    createComment(db, member, { target: onLocation, bodyMd: "a" });
    deleteLocation(db, owner, locationId);
    expect(db.$client.query("select count(*) as n from comments").get()).toEqual({ n: 0 });
  });
});
