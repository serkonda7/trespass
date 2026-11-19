// Evidence quote checks (DESIGN §6.1, §13). Every fact the LLM extracts must
// come with a quote, and the server keeps the fact only if that quote appears
// in the fetched text after normalizing Unicode, case, quotes, dashes and
// whitespace. Paraphrases and made-up quotes fail.

export const QUOTE_MIN_CHARS = 12;
export const QUOTE_MAX_CHARS = 600;

/** NFKC, lower case, typographic quotes/dashes unified, whitespace collapsed. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»‹›]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/­/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `quote` (normalized) is long enough and occurs in `text` (normalized). */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const q = normalizeForQuote(quote);
  if (q.length < QUOTE_MIN_CHARS || q.length > QUOTE_MAX_CHARS) return false;
  return normalizeForQuote(text).includes(q);
}
