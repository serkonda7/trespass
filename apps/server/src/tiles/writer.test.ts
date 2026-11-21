import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTileReader, createTileReader, readTile } from "./store";
import { openTileWriter, tilesFileSize } from "./writer";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "trespass-writer-"));
  dirs.push(dir);
  return join(dir, "tiles.sqlite");
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("MBTiles writer", () => {
  test("upserts are idempotent and ignore invalid coordinates", () => {
    const path = temp();
    const writer = openTileWriter(path);
    try {
      const tile = { z: 3, x: 2, y: 4, data: new Uint8Array([9]) };
      expect(writer.writeTiles([tile, tile])).toBe(2);
      expect(writer.writeTiles([{ ...tile, data: new Uint8Array([8]) }])).toBe(1);
      expect(writer.tileCount()).toBe(1);
      expect(writer.writeTiles([{ z: 1, x: 2, y: 0, data: new Uint8Array([1]) }])).toBe(0);
      expect(writer.totalBytes()).toBe(1);
      expect(tilesFileSize(path)).toBeGreaterThan(0);
      expect(writer.deleteTiles([tile])).toBe(1);
      expect(writer.tileCount()).toBe(0);
    } finally {
      writer.close();
    }
  });

  test("writes MBTiles metadata", () => {
    const path = temp();
    const writer = openTileWriter(path);
    try {
      writer.setMetadata({
        name: "Trespass",
        format: "pbf",
        minzoom: "7",
        maxzoom: "15",
        attribution: "© OpenStreetMap contributors, © Protomaps",
      });
      writer.setMetadata({ name: "Trespass 2" });
      expect(writer.getMetadata()).toEqual({
        name: "Trespass 2",
        format: "pbf",
        minzoom: "7",
        maxzoom: "15",
        attribution: "© OpenStreetMap contributors, © Protomaps",
      });
    } finally {
      writer.close();
    }
  });

  test("the read-only store sees tiles written after it opened the file", () => {
    const path = temp();
    const writer = openTileWriter(path);
    const reader = createTileReader(path);
    try {
      // Reader opens the file on first read, before the worker writes anything.
      expect(readTile(reader, 0, 0, 0)).toBeNull();
      expect(reader.db).not.toBeNull();
      writer.writeTiles([{ z: 0, x: 0, y: 0, data: new Uint8Array([0x1f, 0x8b]) }]);
      expect(readTile(reader, 0, 0, 0)).toEqual(new Uint8Array([0x1f, 0x8b]));
      writer.setMetadata({ name: "after open" });
      expect(writer.getMetadata().name).toBe("after open");
    } finally {
      closeTileReader(reader);
      writer.close();
    }
  });
});
