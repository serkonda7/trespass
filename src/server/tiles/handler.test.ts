import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthCtx } from "../authz/ctx";
import { createTileGetHandler, parseTileCoords, tileResponse } from "./handler";
import { closeTileReader, createTileReader, readTile, type TileReader } from "./store";

const dir = mkdtempSync(join(tmpdir(), "trespass-tiles-"));
const path = join(dir, "tiles.sqlite");
const db = new Database(path, { create: true });
db.exec(
  "CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);",
);
db.query("INSERT INTO tiles VALUES (?, ?, ?, ?)").run(0, 0, 0, Buffer.from([0x1f, 0x8b, 0x08, 1]));
// XYZ (1,1,0) is TMS row 1 (2^1 - 1 - 0).
db.query("INSERT INTO tiles VALUES (?, ?, ?, ?)").run(1, 1, 1, Buffer.from([0x12, 0x34]));
db.close();

const reader: TileReader = createTileReader(path);
afterAll(() => {
  closeTileReader(reader);
  rmSync(dir, { recursive: true, force: true });
});

const ctx: AuthCtx = { userId: "u", role: "admin", groupIds: new Set() };
const request = () => new Request("http://localhost:3000/tiles/0/0/0.mvt");
const call = (
  resolve: (r: Request) => Promise<AuthCtx | null> = async () => ctx,
  params: { z?: string; x?: string; y?: string } = { z: "0", x: "0", y: "0" },
) => createTileGetHandler({ resolve, reader: () => reader })({ request: request(), params });

describe("parseTileCoords", () => {
  test("accepts XYZ integers in range", () => {
    expect(parseTileCoords({ z: "0", x: "0", y: "0" })).toEqual({ z: 0, x: 0, y: 0 });
    expect(parseTileCoords({ z: "15", x: "1234", y: "4321" })).toEqual({
      z: 15,
      x: 1234,
      y: 4321,
    });
  });

  test("rejects non-integers, negatives and out-of-range tiles", () => {
    for (const raw of [
      { z: "-1", x: "0", y: "0" },
      { z: "1.5", x: "0", y: "0" },
      { z: "0", x: "1", y: "0" },
      { z: "1", x: "0", y: "2" },
      { z: "23", x: "0", y: "0" },
      { z: "abc", x: "0", y: "0" },
      { z: "0", x: undefined, y: "0" },
    ]) {
      expect(parseTileCoords(raw)).toBeNull();
    }
  });
});

describe("MBTiles store", () => {
  test("flips XYZ y to the TMS row and reads raw bytes", () => {
    expect(readTile(reader, 1, 1, 0)).toEqual(new Uint8Array([0x12, 0x34]));
    expect(readTile(reader, 1, 1, 1)).toBeNull();
  });

  test("a missing file is simply no tile", () => {
    const missing = createTileReader(join(dir, "not-there.sqlite"));
    expect(readTile(missing, 0, 0, 0)).toBeNull();
    expect(missing.db).toBeNull();
  });
});

describe("tile route", () => {
  test("401 JSON without a session (never a redirect)", async () => {
    const res = await call(async () => null);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()) as unknown).toEqual({ error: "Not authenticated" });
  });

  test("204 when the file has no tile", async () => {
    const empty = createTileReader(join(dir, "empty.sqlite"));
    const res = await createTileGetHandler({ resolve: async () => ctx, reader: () => empty })({
      request: request(),
      params: { z: "0", x: "0", y: "0" },
    });
    expect(res.status).toBe(204);
    closeTileReader(empty);
  });

  test("gzip MVT with the right headers", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.mapbox-vector-tile");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x1f);
  });

  test("raw tiles have no Content-Encoding", async () => {
    const res = tileResponse({ z: 1, x: 1, y: 0 }, reader);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("invalid coordinates answer 400", async () => {
    expect((await call(async () => ctx, { z: "x", x: "0", y: "0" })).status).toBe(400);
    expect(tileResponse(null, reader).status).toBe(400);
  });
});
