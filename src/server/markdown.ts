// Journal Markdown -> sanitized HTML. Never render untrusted text without this.
// `photo:ID` embeds are resolved by the caller (always null until photos land in
// Stage 5); an unresolved embed disappears entirely.
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export type MarkdownOptions = {
  /** Return a URL for a photo embed, or null to drop the image. */
  resolvePhoto: (id: string) => string | null;
};

const PHOTO_EMBED = /!\[([^\]]*)\]\(\s*photo:([A-Za-z0-9_-]+)\s*\)/g;

function resolveEmbeds(md: string, resolvePhoto: MarkdownOptions["resolvePhoto"]): string {
  const withPhotos = md.replace(PHOTO_EMBED, (_match, alt: string, id: string) => {
    const url = resolvePhoto(id);
    return url ? `![${alt}](${url})` : "";
  });
  // Marked leaves links with schemes it cannot parse as plain text; drop those
  // targets here so no `data:`/`javascript:` snippet survives in the output.
  return withPhotos.replace(
    /(!?)\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g,
    (match, image: string, label: string, target: string) => {
      const safe =
        /^(https?:\/\/|mailto:)/i.test(target) ||
        target.startsWith("/files/") ||
        target.startsWith("#");
      return safe ? match : image ? "" : label;
    },
  );
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "h4",
    "a",
    "img",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target"],
    img: ["src", "alt"],
    th: ["align"],
    td: ["align"],
  },
  // Relative /files/… image URLs survive; no external schemes or data: URIs.
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { a: ["http", "https", "mailto"], img: [] },
  transformTags: {
    a: (_tag, attribs): sanitizeHtml.Tag => {
      const href = attribs.href ?? "";
      if (!/^(https?:\/\/|mailto:)/i.test(href)) return { tagName: "span", attribs: {} };
      return {
        tagName: "a",
        attribs: { href, rel: "noopener noreferrer nofollow", target: "_blank" },
      };
    },
    img: (_tag, attribs): sanitizeHtml.Tag => {
      const src = attribs.src ?? "";
      if (!src.startsWith("/files/")) return { tagName: "", attribs: {} };
      return { tagName: "img", attribs: { src, alt: attribs.alt ?? "" } };
    },
  },
};

/** Markdown to HTML safe enough to assign with innerHTML on the client. */
export function renderMarkdown(md: string, opts: MarkdownOptions): string {
  const raw = marked.parse(resolveEmbeds(md, opts.resolvePhoto), { async: false }) as string;
  return sanitizeHtml(raw, SANITIZE_OPTIONS);
}

/** Journals in this stage have no photos; the hook is kept for Stage 5. */
export const renderJournalMarkdown = (md: string): string =>
  renderMarkdown(md, { resolvePhoto: () => null });

/** Plain-text preview of a journal, truncated for the feed. */
export function journalExcerpt(md: string, max = 200): string {
  const text = md
    .replace(PHOTO_EMBED, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
