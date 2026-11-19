// Test-only helpers: run an export into memory and read it back.

import type { AuthCtx } from "@trespass/shared/authz/ctx";
import type { AppDb } from "../db/client";
import type { PhotoStore } from "../photos/storage";
import { type ExportOptions, writeExport } from "./build";
import { createProducerStream } from "./stream";
import { unzipSync } from "./unzip";

// biome-ignore lint/suspicious/noExplicitAny: test-only, shapes are asserted by the tests
export type Json = any;

export const EXPORT_NOW = new Date("2026-11-16T13:03:00Z");

export type ReadArchive = {
  raw: Uint8Array;
  files: Record<string, Uint8Array>;
  names: string[];
  json<T = Json>(path: string): T;
  text(path: string): string;
};

export function readArchive(raw: Uint8Array): ReadArchive {
  const files = unzipSync(raw);
  const decode = new TextDecoder();
  return {
    raw,
    files,
    names: Object.keys(files).sort(),
    json: (p) => {
      const f = files[p];
      if (!f) throw new Error(`missing ${p}`);
      return JSON.parse(decode.decode(f));
    },
    text: (p) => {
      const f = files[p];
      if (!f) throw new Error(`missing ${p}`);
      return decode.decode(f);
    },
  };
}

export async function exportToMemory(
  db: AppDb,
  ctx: AuthCtx,
  store: PhotoStore,
  opts: Partial<ExportOptions> = {},
): Promise<ReadArchive> {
  const stream = createProducerStream(async (write) => {
    await writeExport(write, { db, ctx, store, now: EXPORT_NOW, ...opts });
  });
  return readArchive(new Uint8Array(await new Response(stream).arrayBuffer()));
}
