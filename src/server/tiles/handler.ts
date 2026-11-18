// GET /tiles/{z}/{x}/{y}.mvt (DESIGN §7.2): a session is required, but there
// are no per-location checks — tile coverage is coarse by design. No tiles file
// yet means 204 for every tile.
import { withAuth } from "../auth/context";
import type { AuthCtx } from "../authz/ctx";
import { readTile, type TileReader } from "./store";

export const MAX_TILE_ZOOM = 22;

export type TileCoords = { z: number; x: number; y: number };

const uint = (raw: string): number | null => {
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
};

/** XYZ tile coordinates, or null for anything out of range. */
export function parseTileCoords(raw: {
  z?: string | undefined;
  x?: string | undefined;
  y?: string | undefined;
}): TileCoords | null {
  if (raw.z === undefined || raw.x === undefined || raw.y === undefined) return null;
  const z = uint(raw.z);
  const x = uint(raw.x);
  const y = uint(raw.y);
  if (z === null || x === null || y === null) return null;
  if (z > MAX_TILE_ZOOM || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y };
}

/** Protomaps tiles are gzip-compressed MVT blobs in MBTiles. */
export function tileResponse(coords: TileCoords | null, reader: TileReader): Response {
  if (!coords) return new Response(null, { status: 400 });
  const data = readTile(reader, coords.z, coords.x, coords.y);
  if (!data) return new Response(null, { status: 204 });
  const gzip = data[0] === 0x1f && data[1] === 0x8b;
  return new Response(Buffer.from(data), {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "private, max-age=86400",
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
    },
  });
}

/**
 * The route handler factory. `resolve` is injectable so the 401 path can be
 * unit-tested; the route passes the real request-session resolver.
 */
export function createTileGetHandler(deps: {
  resolve: (request: Request) => Promise<AuthCtx | null>;
  reader: () => TileReader;
}) {
  return withAuth(
    ({ params }: { request: Request; params: { z?: string; x?: string; y?: string } }) =>
      tileResponse(parseTileCoords(params), deps.reader()),
    { resolve: deps.resolve },
  );
}
