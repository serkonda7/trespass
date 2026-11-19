import { describe, expect, test } from "bun:test";
import { unzipSync } from "./unzip";
import { ZipWriter } from "./zip";

const enc = new TextEncoder();
const DEFLATED = enc.encode("lorem ipsum dolor sit amet ".repeat(100));
const STORED = new Uint8Array([0, 1, 2, 3, 255, 254, 128]);

async function build(opts?: { forceZip64?: boolean }): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const writer = new ZipWriter(
    async (chunk) => {
      chunks.push(chunk);
    },
    { date: new Date("2026-11-16T13:03:00Z"), ...opts },
  );
  // Several writes so the data descriptor and streaming deflate are exercised.
  await writer.add(
    "deflated.txt",
    [DEFLATED.subarray(0, 100), DEFLATED.subarray(100), new Uint8Array(0)],
    { compress: true, size: DEFLATED.length },
  );
  await writer.add("stored.bin", [STORED], { compress: false, size: STORED.length });
  await writer.finish();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

describe("zip round-trip (node-only reader)", () => {
  test("stored and deflated entries survive data descriptors", async () => {
    const files = unzipSync(await build());
    expect(Object.keys(files).sort()).toEqual(["deflated.txt", "stored.bin"]);
    expect(files["deflated.txt"]).toEqual(DEFLATED);
    expect(files["stored.bin"]).toEqual(STORED);
  });

  test("ZIP64 entries and end records are read from the central directory", async () => {
    const files = unzipSync(await build({ forceZip64: true }));
    expect(files["deflated.txt"]).toEqual(DEFLATED);
    expect(files["stored.bin"]).toEqual(STORED);
  });

  test("the writer is deterministic for the same input", async () => {
    expect(await build()).toEqual(await build());
  });

  test("a corrupted entry fails the CRC check", async () => {
    const raw = await build();
    raw[raw.length - 60] = raw[raw.length - 60]! ^ 0xff;
    expect(() => unzipSync(raw)).toThrow();
  });
});
