// Minimal ZIP reader for export tests and the Playwright e2e suite. It uses
// only node: modules, so Node can import it just like Bun. Sizes come from the
// central directory (local headers carry data descriptors instead), and ZIP64
// plus stored/deflated entries are supported.

import { crc32, inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

/** Reads a ZIP archive into a name -> bytes map (like fflate's unzipSync). */
export function unzipSync(raw: Uint8Array): Record<string, Uint8Array> {
  if (raw.length < 22) throw new Error("unzip: not a ZIP archive");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  const u32 = (o: number) => view.getUint32(o, true);
  const u64 = (o: number) => view.getBigUint64(o, true);
  const decode = new TextDecoder();

  // The EOCD is the last structure, followed by at most 65535 comment bytes.
  let eocd = -1;
  for (let i = raw.length - 22; i >= Math.max(0, raw.length - 22 - MAX16); i--) {
    if (u32(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("unzip: end of central directory not found");
  let count = u16(eocd + 10);
  let cdSize = u32(eocd + 12);
  let cdOffset = u32(eocd + 16);
  if (count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) {
    const loc = eocd - 20;
    if (loc < 0 || u32(loc) !== LOCATOR64) throw new Error("unzip: ZIP64 locator not found");
    const rec = Number(u64(loc + 8));
    if (rec < 0 || u32(rec) !== EOCD64) throw new Error("unzip: ZIP64 end record not found");
    count = Number(u64(rec + 32));
    cdSize = Number(u64(rec + 40));
    cdOffset = Number(u64(rec + 48));
  }

  const files: Record<string, Uint8Array> = {};
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > raw.length || u32(p) !== CENTRAL)
      throw new Error(`unzip: bad central directory record at ${p}`);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    let compressedSize = u32(p + 20);
    let size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    let localOffset = u32(p + 42);
    const name = decode.decode(raw.subarray(p + 46, p + 46 + nameLen));

    // ZIP64 extra fields only carry values whose 32-bit slot is saturated, in
    // this fixed order: uncompressed, compressed, local offset, disk number.
    const extraEnd = p + 46 + nameLen + extraLen;
    for (let ep = p + 46 + nameLen; ep + 4 <= extraEnd; ) {
      const id = u16(ep);
      const len = u16(ep + 2);
      const data = ep + 4;
      if (id === 0x0001) {
        let d = data;
        if (size === MAX32) {
          size = Number(u64(d));
          d += 8;
        }
        if (compressedSize === MAX32) {
          compressedSize = Number(u64(d));
          d += 8;
        }
        if (localOffset === MAX32) {
          localOffset = Number(u64(d));
          d += 8;
        }
      }
      ep = data + len;
      if (ep > extraEnd) throw new Error(`unzip: bad extra field for ${name}`);
    }

    if (u32(localOffset) !== LOCAL) throw new Error(`unzip: bad local header for ${name}`);
    const dataStart = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    const compressed = raw.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new Error(`unzip: truncated entry ${name}`);
    let bytes: Uint8Array;
    if (method === 0) bytes = compressed.slice();
    else if (method === 8) bytes = inflateRawSync(compressed);
    else throw new Error(`unzip: unsupported method ${method} for ${name}`);
    if (bytes.length !== size || crc32(bytes) !== crc)
      throw new Error(`unzip: bad CRC or size for ${name}`);
    files[name] = bytes;
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== cdOffset + cdSize) throw new Error("unzip: central directory size mismatch");
  return files;
}
