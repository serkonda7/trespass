// Content-addressed blob store under UPLOAD_DIR (DESIGN §5.3, §8.4):
//   <root>/ab/cd/<sha256>                  the original, exactly as uploaded
//   <root>/derived/<sha256>/<size>.webp    metadata-free derivatives (rebuildable)
//   <root>/tmp/                            in-flight writes, renamed into place
// Writes are atomic (temp file, fsync, rename), so a reader never sees half a
// file. Deleting blobs is the job of gc.ts, which checks references first.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PhotoSize } from "../../lib/photos/types";
import { PHOTO_SIZES } from "../../lib/photos/types";
import { getEnv } from "../env";

const SHA_RE = /^[0-9a-f]{64}$/;

export const isSha256 = (s: string) => SHA_RE.test(s);

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type PhotoStore = ReturnType<typeof createPhotoStore>;

export function createPhotoStore(rootDir: string) {
  const root = resolve(rootDir);
  const tmpDir = join(root, "tmp");

  function check(sha: string) {
    if (!isSha256(sha)) throw new Error(`invalid sha256: ${sha}`);
  }
  const blobPath = (sha: string) => {
    check(sha);
    return join(root, sha.slice(0, 2), sha.slice(2, 4), sha);
  };
  const derivedPath = (sha: string, size: PhotoSize) => {
    check(sha);
    return join(root, "derived", sha, `${size}.webp`);
  };
  const tmpPath = () => join(tmpDir, `${Bun.randomUUIDv7()}.tmp`);

  async function writeAtomic(target: string, bytes: Uint8Array) {
    await mkdir(tmpDir, { recursive: true });
    await mkdir(dirname(target), { recursive: true });
    const tmp = tmpPath();
    const fh = await open(tmp, "wx", 0o640);
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  /** A fresh temp file for a streaming upload (caller writes, fsyncs, closes). */
  function createTmp(): { path: string; fd: number } {
    mkdirSync(tmpDir, { recursive: true });
    const path = tmpPath();
    return { path, fd: openSync(path, "wx", 0o640) };
  }

  /**
   * Moves a finished temp file into the blob path synchronously, so the row
   * insert that follows cannot interleave with a GC unlink (see gc.ts).
   * Dedupes: when the hash is already stored the temp file is discarded.
   */
  function commitBlobSync(tmp: string, sha: string): boolean {
    check(sha);
    const target = blobPath(sha);
    if (existsSync(target)) {
      rmSync(tmp, { force: true });
      return false;
    }
    mkdirSync(dirname(target), { recursive: true });
    renameSync(tmp, target);
    return true;
  }

  /** Test/helper variant: store bytes under their sha256 (dedupe). */
  async function put(bytes: Uint8Array): Promise<{ sha256: string; created: boolean }> {
    const sha256 = sha256Hex(bytes);
    const target = blobPath(sha256);
    if (existsSync(target)) return { sha256, created: false };
    await writeAtomic(target, bytes);
    return { sha256, created: true };
  }

  /** Ensures the blob exists in the same tick as a row insert. */
  function ensureBlobSync(sha256: string, bytes: Uint8Array) {
    const target = blobPath(sha256);
    if (!existsSync(target)) {
      mkdirSync(tmpDir, { recursive: true });
      mkdirSync(dirname(target), { recursive: true });
      const tmp = tmpPath();
      const fd = openSync(tmp, "wx", 0o640);
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, target);
    }
  }

  async function putDerived(sha256: string, size: PhotoSize, bytes: Uint8Array) {
    await writeAtomic(derivedPath(sha256, size), bytes);
  }

  /** Removes a blob, all its derivatives and any leftover temp files for it. */
  function removeSync(sha256: string) {
    check(sha256);
    rmSync(blobPath(sha256), { force: true });
    rmSync(join(root, "derived", sha256), { recursive: true, force: true });
  }

  return {
    root,
    tmpDir,
    blobPath,
    derivedPath,
    tmpPath,
    createTmp,
    commitBlobSync,
    put,
    ensureBlobSync,
    putDerived,
    hasBlob: (sha: string) => existsSync(blobPath(sha)),
    hasDerived: (sha: string, size: PhotoSize) => existsSync(derivedPath(sha, size)),
    hasAnyDerived: (sha: string) => PHOTO_SIZES.some((s) => existsSync(derivedPath(sha, s))),
    removeSync,
  };
}

let instance: PhotoStore | undefined;

/** The process-wide store on UPLOAD_DIR. Tests use createPhotoStore(tempDir). */
export function getPhotoStore(): PhotoStore {
  instance ??= createPhotoStore(getEnv().UPLOAD_DIR);
  return instance;
}
