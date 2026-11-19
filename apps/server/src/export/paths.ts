// Readable, collision-free path segments inside the archive. Names come from
// user data (location names), so every segment is sanitized: no separators,
// control characters or characters Windows refuses, no leading dots, bounded
// length. Journal paths also carry the visit id, so names cannot collide.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** One path segment from free text; `fallback` when nothing is left. */
export function safeSegment(text: string | null | undefined, fallback: string, max = 60): string {
  let s = (text ?? "")
    .normalize("NFC")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if ([...s].length > max) s = [...s].slice(0, max).join("").trim();
  if (!s || RESERVED.test(s)) return fallback;
  return s;
}

/** Lower-case, dash-separated slug for a location name in a journal file name. */
export function slug(text: string | null | undefined, fallback: string): string {
  const base = safeSegment(text, fallback, 80)
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || fallback;
}

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/** Original photo extension (derivatives are always WebP). */
export const photoExtension = (mime: string) => EXT[mime] ?? ".bin";
