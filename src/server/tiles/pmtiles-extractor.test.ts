import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zxyToTileId } from "pmtiles";
import { createPmTilesExtractor, readPmTilesFile } from "./pmtiles-extractor";
import type { TileEntry } from "./types";

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

type DirEntry = { tileId: number; runLength: number; length: number; offset: number };

function directory(entries: readonly DirEntry[]): Buffer {
  const bytes: number[] = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) {
    bytes.push(...varint(e.tileId - last));
    last = e.tileId;
  }
  for (const e of entries) bytes.push(...varint(e.runLength));
  for (const e of entries) bytes.push(...varint(e.length));
  for (const e of entries) bytes.push(...varint(e.offset + 1)); // 0 = "after previous"
  return Buffer.from(bytes);
}

/** A tiny PMTiles v3 archive with uncompressed directories, hand-written. */
function fixture(path: string) {
  const id00 = zxyToTileId(0, 0, 0);
  const id10 = zxyToTileId(1, 0, 0);
  const id20 = zxyToTileId(2, 0, 0);
  const leaf = directory([
    { tileId: id10, runLength: 2, length: 4, offset: 3 }, // run-length
    { tileId: id20, runLength: 1, length: 5, offset: 11 },
  ]);
  const root = directory([
    { tileId: id00, runLength: 1, length: 3, offset: 0 },
    { tileId: id10, runLength: 0, length: leaf.length, offset: 0 }, // leaf directory
  ]);
  const metadata = Buffer.from(JSON.stringify({ vector_layers: [{ id: "protomaps" }] }));
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header[7] = 3;
  const rootOffset = 127;
  const leafOffset = rootOffset + root.length;
  const metaOffset = leafOffset + leaf.length;
  const dataOffset = metaOffset + metadata.length;
  header.writeBigUInt64LE(BigInt(rootOffset), 8);
  header.writeBigUInt64LE(BigInt(root.length), 16);
  header.writeBigUInt64LE(BigInt(metaOffset), 24);
  header.writeBigUInt64LE(BigInt(metadata.length), 32);
  header.writeBigUInt64LE(BigInt(leafOffset), 40);
  header.writeBigUInt64LE(BigInt(leaf.length), 48);
  header.writeBigUInt64LE(BigInt(dataOffset), 56);
  header.writeBigUInt64LE(BigInt(16), 64);
  header.writeBigUInt64LE(BigInt(4), 72);
  header.writeBigUInt64LE(BigInt(3), 80);
  header.writeBigUInt64LE(BigInt(3), 88);
  header[97] = 1; // internal compression: none
  header[98] = 1; // tile compression: none (raw bytes)
  header[99] = 1; // MVT
  header[100] = 0;
  header[101] = 2;
  header.writeInt32LE(0, 102);
  header.writeInt32LE(0, 106);
  header.writeInt32LE(180_000_000, 110);
  header.writeInt32LE(85_000_000, 114);
  const data = Buffer.concat([
    Buffer.from([1, 2, 3]),
    Buffer.from([4, 4, 4, 4]),
    Buffer.from([5, 5, 5, 5]),
    Buffer.from([6, 6, 6, 6, 6]),
  ]);
  writeFileSync(path, Buffer.concat([header, root, leaf, metadata, data]));
}

async function collect(tiles: AsyncIterable<TileEntry>): Promise<TileEntry[]> {
  const out: TileEntry[] = [];
  for await (const tile of tiles) out.push(tile);
  return out;
}

describe("build discovery", () => {
  test("probes today first, then earlier days, and reports the build date", async () => {
    const probed: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      probed.push(String(url));
      return new Response(null, { status: probed.length < 3 ? 404 : 200 });
    }) as typeof globalThis.fetch;
    const extractor = createPmTilesExtractor({
      fetch: fakeFetch,
      now: () => new Date("2026-11-18T12:00:00Z"),
    });
    const build = await extractor.latestBuild();
    expect(probed[0]).toBe("https://build.protomaps.com/20261118.pmtiles");
    expect(probed[2]).toBe("https://build.protomaps.com/20261116.pmtiles");
    expect(build).toEqual({
      url: "https://build.protomaps.com/20261116.pmtiles",
      date: "2026-11-16",
    });
  });

  test("an override is used verbatim without any HEAD probe", async () => {
    const fakeFetch = (async () => {
      throw new Error("no network in tests");
    }) as unknown as typeof globalThis.fetch;
    const extractor = createPmTilesExtractor({
      buildUrl: "https://example.test/custom.pmtiles?date=20260102",
      fetch: fakeFetch,
    });
    expect(await extractor.latestBuild()).toEqual({
      url: "https://example.test/custom.pmtiles?date=20260102",
      date: "2026-01-02",
    });
  });
});

describe("PMTiles reader", () => {
  test("walks the root, leaf directories and run-lengths without changing bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trespass-pmtiles-test-"));
    const path = join(dir, "tiny.pmtiles");
    try {
      fixture(path);
      let meta: Record<string, string> | undefined;
      const tiles = await collect(readPmTilesFile(path, undefined, (m) => (meta = m)));
      expect(tiles.length).toBe(4);
      const byId = new Map(tiles.map((t) => [zxyToTileId(t.z, t.x, t.y), t]));
      expect([...byId.get(zxyToTileId(0, 0, 0))!.data]).toEqual([1, 2, 3]);
      expect([...byId.get(zxyToTileId(1, 0, 0))!.data]).toEqual([4, 4, 4, 4]);
      expect([...byId.get(zxyToTileId(1, 0, 1))!.data]).toEqual([5, 5, 5, 5]);
      expect([...byId.get(zxyToTileId(2, 0, 0))!.data]).toEqual([6, 6, 6, 6, 6]);
      expect(meta?.json).toContain("protomaps");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an aborted signal stops the walk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trespass-pmtiles-test-"));
    const path = join(dir, "tiny.pmtiles");
    try {
      fixture(path);
      const ac = new AbortController();
      ac.abort();
      expect(collect(readPmTilesFile(path, ac.signal))).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
