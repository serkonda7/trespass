// Shared server-side tile types. The extractor is injected into the jobs so
// tests can use a fake and never touch the network or the pmtiles CLI.
import type { Bbox } from "../../lib/geo/types";

export type TileEntry = { z: number; x: number; y: number; data: Uint8Array };

export type ExtractArgs = {
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  signal?: AbortSignal;
  /** Already resolved by the caller (one HEAD probe per extraction). */
  buildUrl?: string;
};

/** An async iterable of raw (gzip-compressed MVT) tiles plus optional metadata. */
export type TileIterable = AsyncIterable<TileEntry> & {
  /** MBTiles `json` metadata (vector_layers) from the archive, if available. */
  metadata?: () => Record<string, string> | undefined;
};

export interface TileExtractor {
  /** The newest Protomaps daily build (or the configured override). */
  latestBuild(): Promise<{ url: string; date: string }>;
  extract(args: ExtractArgs): TileIterable;
}
