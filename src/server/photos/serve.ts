// GET /files/:photoId?size=400|1600|2560|original (default 1600). Explicit
// authorization through visiblePhotosWhere; originals are 404 for everyone but
// the uploader/admins, so their existence is not revealed. Only metadata-free
// derivatives reach other users (DESIGN §3.4 rule 6, §5.3). Content-addressed
// files are immutable and cached privately; ETag = sha + size. While a photo is
// processing a derivative request gets 202 + Retry-After (the UI polls again);
// a failed one gets 404.
import { and, eq } from "drizzle-orm";
import type { PhotoSize } from "../../lib/photos/types";
import { PHOTO_SIZES } from "../../lib/photos/types";
import { canSeePhotoOriginal, visiblePhotosWhere } from "../authz";
import type { AuthCtx } from "../authz/ctx";
import type { AppDb } from "../db/client";
import { photos } from "../db/schema";
import type { PhotoStore } from "./storage";

const notFound = () =>
  new Response(JSON.stringify({ error: "PHOTO_NOT_FOUND" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** RFC 6266 / 5987 header value: an ASCII fallback plus the UTF-8 name. */
export function contentDisposition(name: string): string {
  const ascii = name
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[;%]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Parses one `bytes=a-b` range; null = serve whole, "invalid" = 416. */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

const etagMatches = (header: string | null, etag: string): boolean => {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
};

export async function servePhoto(
  db: AppDb,
  ctx: AuthCtx,
  store: PhotoStore,
  request: Request,
  photoId: string,
): Promise<Response> {
  const photo = db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), visiblePhotosWhere(ctx, photos)))
    .get();
  if (!photo) return notFound();

  const raw = new URL(request.url).searchParams.get("size") ?? "1600";
  const original = raw === "original";
  const size = (PHOTO_SIZES as readonly number[]).includes(Number(raw))
    ? (Number(raw) as PhotoSize)
    : 1600;
  if (original && !canSeePhotoOriginal(ctx, photo)) return notFound();

  let path: string;
  let mime: string;
  if (original) {
    path = store.blobPath(photo.sha256);
    mime = photo.mime;
  } else {
    if (photo.status === "processing") {
      return new Response(JSON.stringify({ status: "processing" }), {
        status: 202,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          "Retry-After": "1",
        },
      });
    }
    path = store.derivedPath(photo.sha256, size);
    mime = "image/webp";
  }
  const file = Bun.file(path);
  if (!(await file.exists())) return notFound();

  const etag = `"${photo.sha256}-${original ? "original" : size}"`;
  const headers: Record<string, string> = {
    ...securityHeaders,
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(photo.originalName ?? "foto"),
    ETag: etag,
    // Private browser cache: the bytes are immutable, access is re-checked on
    // every request by this handler before the cached response is used.
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };
  if (etagMatches(request.headers.get("If-None-Match"), etag))
    return new Response(null, { status: 304, headers });

  const byteSize = file.size;
  const ifRange = request.headers.get("If-Range");
  const range =
    ifRange && ifRange.trim() !== etag ? null : parseRange(request.headers.get("Range"), byteSize);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${byteSize}` },
    });
  }
  if (range) {
    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${byteSize}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(request.method === "HEAD" ? null : file, {
    status: 200,
    headers: { ...headers, "Content-Length": String(byteSize) },
  });
}
