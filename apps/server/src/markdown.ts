// Journal Markdown -> sanitized HTML. Never render untrusted text without this.
// `photo:ID` embeds are resolved by the caller with a batch SQL visibility check
// (photos/resolvePhotoEmbeds); an unresolved embed disappears entirely.
//
// The HTML is built constructively with Bun.markdown.render's callbacks: only
// the allowlisted tags below are ever emitted, and all text/attribute values
// are escaped. Raw HTML cannot become a tag (noHtmlBlocks/noHtmlSpans) and is
// stripped from the Markdown before parsing, like sanitize-html did.

export type MarkdownOptions = {
  /** Return a URL for a photo embed, or null to drop the image. */
  resolvePhoto?: (id: string) => string | null;
};

const PHOTO_EMBED = /!\[([^\]]*)\]\(\s*photo:([A-Za-z0-9_-]+)\s*\)/g;

/** Distinct photo ids referenced by a Markdown text (for one batch SQL check). */
export function photoEmbedIds(md: string): string[] {
  return [...md.matchAll(PHOTO_EMBED)]
    .map((m) => m[2]!)
    .filter((id, i, all) => all.indexOf(id) === i);
}

function resolveEmbeds(md: string, resolvePhoto: MarkdownOptions["resolvePhoto"]): string {
  const withPhotos = md.replace(PHOTO_EMBED, (_match, alt: string, id: string) => {
    const url = resolvePhoto?.(id) ?? null;
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

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** Escape text and attribute values. Bun's callbacks hand us raw, decoded text. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

// Tags whose *content* sanitize-html discarded as well (nonTextTags), plus a
// few more container tags that must never contribute untrusted markup.
const NON_TEXT_TAG =
  /<\s*(script|style|textarea|option|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const OPEN_NON_TEXT_TAG =
  /<\s*(script|style|textarea|option|iframe|object|embed|noscript)\b[^>]*>[\s\S]*$/gi;
// Any other raw tag is dropped but its text content is kept, as before.
const RAW_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])[^>]*>/g;
// Angle autolinks (<https://…>, <a@b.de>) survive as text with noHtmlSpans;
// hand them to Bun's autolinker as bare URLs/emails instead.
const ANGLE_AUTOLINK = /<\s*(https?:\/\/[^>\s]+|[^\s<>@]+@[^\s<>@]+)\s*>/gi;
// Fenced and inline code is left alone: `<script>` in an example stays text.
const CODE_TOKEN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function stripRawHtml(md: string): string {
  return md
    .split(CODE_TOKEN)
    .map((part, i) => {
      if (i % 2 === 1) return part; // code token
      return part
        .replace(ANGLE_AUTOLINK, "$1")
        .replace(NON_TEXT_TAG, "")
        .replace(OPEN_NON_TEXT_TAG, "")
        .replace(RAW_TAG, "");
    })
    .join("");
}

const OPTS: Bun.markdown.Options = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  // Raw HTML is never allowed to become markup; the html callback is a second
  // line of defence (with these options it is normally not called at all).
  noHtmlBlocks: true,
  noHtmlSpans: true,
  autolinks: { url: true, email: true },
};

/** GitHub-style link targets: bare email autolinks arrive without `mailto:`. */
function safeLinkTarget(href: string): string | null {
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return /^[^\s/@]+@[^\s/@]+$/.test(href) ? `mailto:${href}` : null;
}

const cell = (tag: "th" | "td") => (children: string, meta?: Bun.markdown.CellMeta) => {
  const align = meta?.align ? ` align="${escapeHtml(meta.align)}"` : "";
  return `<${tag}${align}>${children}</${tag}>`;
};

const CALLBACKS: Bun.markdown.RenderCallbacks = {
  // text callbacks receive raw (unescaped, entity-decoded) content.
  text: escapeHtml,
  html: escapeHtml,
  paragraph: (children) => `<p>${children}</p>`,
  // h1/h5/h6 are not allowed: keep the text as its own paragraph.
  heading: (children, { level }) =>
    level >= 2 && level <= 4 ? `<h${level}>${children}</h${level}>` : `<p>${children}</p>`,
  strong: (children) => `<strong>${children}</strong>`,
  emphasis: (children) => `<em>${children}</em>`,
  strikethrough: (children) => `<del>${children}</del>`,
  codespan: (children) => `<code>${children}</code>`,
  code: (children) => `<pre><code>${children}</code></pre>`,
  blockquote: (children) => `<blockquote>${children}</blockquote>`,
  hr: () => "<hr />",
  list: (children, meta) =>
    meta.ordered
      ? `<ol${meta.start && meta.start !== 1 ? ` start="${meta.start}"` : ""}>${children}</ol>`
      : `<ul>${children}</ul>`,
  // Task-list state is dropped: no checkbox inputs in the allowlist.
  listItem: (children) => `<li>${children}</li>`,
  table: (children) => `<table>${children}</table>`,
  thead: (children) => `<thead>${children}</thead>`,
  tbody: (children) => `<tbody>${children}</tbody>`,
  tr: (children) => `<tr>${children}</tr>`,
  th: cell("th"),
  td: cell("td"),
  link: (children, { href }) => {
    const target = safeLinkTarget(href);
    if (!target) return `<span>${children}</span>`;
    return `<a href="${escapeHtml(target)}" rel="noopener noreferrer nofollow" target="_blank">${children}</a>`;
  },
  // Alt text is the image's children, already escaped by the text callback.
  image: (children, { src }) =>
    src.startsWith("/files/") ? `<img src="${escapeHtml(src)}" alt="${children}">` : null,
};

/** Markdown to HTML safe enough to assign with innerHTML on the client. */
export function renderMarkdown(md: string, opts: MarkdownOptions): string {
  return Bun.markdown.render(stripRawHtml(resolveEmbeds(md, opts.resolvePhoto)), CALLBACKS, OPTS);
}

/** Journal Markdown with visible `photo:ID` embeds resolved by the caller. */
export const renderJournalMarkdown = (md: string, opts?: MarkdownOptions): string =>
  renderMarkdown(md, opts ?? { resolvePhoto: () => null });

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
