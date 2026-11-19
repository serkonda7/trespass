// Readable text from a fetched page (DESIGN §6.3 `fetch`): Readability on a
// linkedom document, plain text otherwise. Scripts and styles never reach the
// LLM; the quote check runs against exactly the text returned here.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/** Upper bound of text handed to the LLM per page (about 15k tokens). */
export const PAGE_TEXT_MAX_CHARS = 60_000;

export type PageText = { title: string | null; text: string };

const collapse = (s: string) =>
  s
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function extractText(body: string, contentType: string | null): PageText {
  if (contentType && /^text\/plain/i.test(contentType)) {
    return { title: null, text: collapse(body).slice(0, PAGE_TEXT_MAX_CHARS) };
  }
  const { document } = parseHTML(body);
  for (const el of document.querySelectorAll("script,style,noscript,template,iframe,svg"))
    el.remove();
  const title = document.querySelector("title")?.textContent?.trim() || null;
  let text = "";
  try {
    const article = new Readability(document as unknown as Document).parse();
    text = article?.textContent ?? "";
    if (article?.title)
      return { title: article.title.trim(), text: collapse(text).slice(0, PAGE_TEXT_MAX_CHARS) };
  } catch {
    // fall through to the body text
  }
  if (!text) text = document.body?.textContent ?? document.documentElement?.textContent ?? "";
  return { title, text: collapse(text).slice(0, PAGE_TEXT_MAX_CHARS) };
}
