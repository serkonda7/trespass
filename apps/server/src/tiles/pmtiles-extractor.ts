// Worker-only extraction from a Protomaps daily build (DESIGN §7.1): the CLI
// range-downloads the bbox, then a local `pmtiles` Source walks the archive.
// Tile bytes are copied unchanged. Reader and build-URL probe are injectable.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitBbox } from "@trespass/shared/geo/distance";
import type { Bbox } from "@trespass/shared/geo/types";
import {
  type Entry,
  type Header,
  PMTiles,
  ResolvedValueCache,
  type Source,
  tileIdToZxy,
  zxyToTileId,
} from "pmtiles";
import { getEnv } from "../env";
import type { ExtractArgs, TileEntry, TileExtractor, TileIterable } from "./types";

export const DEFAULT_BUILD_BASE = "https://build.protomaps.com";
export const MAX_BUILD_LOOKBACK_DAYS = 10;

export type ExtractorOptions = {
  bin?: string;
  buildUrl?: string;
  baseUrl?: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
};

function buildDay(at: Date): string {
  return at.toISOString().slice(0, 10).replace(/-/g, "");
}

/** Date encoded in a build URL ('YYYYMMDD'), or the day passed in. */
function buildDateOf(url: string, now: Date): string {
  const match = /(\d{4})(\d{2})(\d{2})/.exec(url);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return now.toISOString().slice(0, 10);
}

/**
 * Reads byte ranges of a local archive with Bun.file().slice. This is the
 * `Source` the `pmtiles` package needs; nothing here fetches from the network.
 */
export function localFileSource(path: string): Source {
  return {
    getKey: () => path,
    getBytes: async (offset, length, signal) => {
      signal?.throwIfAborted();
      const data = await Bun.file(path)
        .slice(offset, offset + length)
        .arrayBuffer();
      return { data };
    },
  };
}

type LocalMeta = Record<string, string> | undefined;

/**
 * Walks every tile entry of a PMTiles v3 archive: the root directory, leaf
 * directories (recursively) and run-lengths. Tile data is read raw, without
 * decompression, so gzip MVT blobs stay byte-identical.
 */
export async function* readPmTilesFile(
  path: string,
  signal?: AbortSignal,
  onMeta?: (meta: LocalMeta) => void,
): AsyncGenerator<TileEntry> {
  const source = localFileSource(path);
  const cache = new ResolvedValueCache();
  const header: Header = await cache.getHeader(source);
  signal?.throwIfAborted();
  try {
    const raw = await new PMTiles(source, cache).getMetadata();
    const vectorLayers =
      raw && typeof raw === "object" && "vector_layers" in raw
        ? (raw as { vector_layers: unknown }).vector_layers
        : undefined;
    onMeta?.(
      vectorLayers === undefined
        ? undefined
        : { json: JSON.stringify({ vector_layers: vectorLayers }) },
    );
  } catch {
    onMeta?.(undefined); // archives without JSON metadata are still usable
  }

  async function* walk(offset: number, length: number, depth: number): AsyncGenerator<TileEntry> {
    if (depth > 3) throw new Error("pmtiles directory depth exceeded");
    const entries: readonly Entry[] = await cache.getDirectory(
      source,
      offset,
      length,
      header,
      signal,
    );
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.runLength === 0) {
        yield* walk(header.leafDirectoryOffset + entry.offset, entry.length, depth + 1);
        continue;
      }
      for (let i = 0; i < entry.runLength; i++) {
        signal?.throwIfAborted();
        const [z, x, y] = tileIdToZxy(entry.tileId + i);
        const bytes = await source.getBytes(
          header.tileDataOffset + entry.offset + i * entry.length,
          entry.length,
          signal,
        );
        yield { z, x, y, data: new Uint8Array(bytes.data) };
      }
    }
  }
  yield* walk(header.rootDirectoryOffset, header.rootDirectoryLength, 0);
}

export function createPmTilesExtractor(opts: ExtractorOptions = {}): TileExtractor {
  const env = getEnv();
  const bin = opts.bin ?? env.PMTILES_BIN ?? "pmtiles";
  const override = opts.buildUrl ?? env.TILES_BUILD_URL;
  const base = opts.baseUrl ?? DEFAULT_BUILD_BASE;
  const now = opts.now ?? (() => new Date());
  const doFetch = opts.fetch ?? globalThis.fetch;

  async function latestBuild(): Promise<{ url: string; date: string }> {
    if (override) {
      // An explicit override points at one archive; it needs no HEAD probe.
      return { url: override, date: buildDateOf(override, now()) };
    }
    const today = now();
    for (let days = 0; days < MAX_BUILD_LOOKBACK_DAYS; days++) {
      const at = new Date(today.getTime() - days * 86_400_000);
      const day = buildDay(at);
      const url = `${base.replace(/\/$/, "")}/${day}.pmtiles`;
      const res = await doFetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { url, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` };
    }
    throw new Error("no recent Protomaps build found");
  }

  async function runCli(url: string, bbox: Bbox, out: string, args: ExtractArgs) {
    const proc = Bun.spawn(
      [
        bin,
        "extract",
        url,
        out,
        `--bbox=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
        `--minzoom=${args.minZoom}`,
        `--maxzoom=${args.maxZoom}`,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const onAbort = () => proc.kill();
    args.signal?.addEventListener("abort", onAbort);
    try {
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      if (args.signal?.aborted) throw new Error("aborted");
      if (code !== 0) throw new Error(`pmtiles extract failed: ${stderr.slice(-500)}`);
    } finally {
      args.signal?.removeEventListener("abort", onAbort);
    }
  }

  function extract(args: ExtractArgs): TileIterable {
    let meta: LocalMeta;
    const stream = (async function* (): AsyncGenerator<TileEntry> {
      const build = args.buildUrl ? { url: args.buildUrl, date: "" } : await latestBuild();
      const dir = mkdtempSync(join(tmpdir(), "trespass-pmtiles-"));
      const seen = new Set<number>();
      try {
        const parts = splitBbox(args.bbox);
        for (let i = 0; i < parts.length; i++) {
          args.signal?.throwIfAborted();
          const out = join(dir, `part-${i}.pmtiles`);
          await runCli(build.url, parts[i]!, out, args);
          for await (const tile of readPmTilesFile(out, args.signal, (m) => {
            meta = m;
          })) {
            // Two split halves can share edge tiles; keep each tile once.
            const id = zxyToTileId(tile.z, tile.x, tile.y);
            if (seen.has(id)) continue;
            seen.add(id);
            yield tile;
          }
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })();
    return Object.assign(stream, { metadata: () => meta });
  }

  return { extract, latestBuild };
}
