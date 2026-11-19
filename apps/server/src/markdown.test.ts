import { describe, expect, test } from "bun:test";
import { journalExcerpt, renderJournalMarkdown, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  test("renders the journal formatting we allow", () => {
    const html = renderJournalMarkdown("**fett** _kursiv_ ~~weg~~\n\n- eins\n- zwei");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<del>weg</del>");
    expect(html).toContain("<ul>");
  });

  test("strips scripts, event handlers, javascript links and data images", () => {
    const html = renderJournalMarkdown(
      [
        '<script>alert("x")</script>',
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">böse</a>',
        "![x](data:image/svg+xml;base64,PHN2Zz4=)",
        "<style>body{display:none}</style>",
        "**sicher**",
      ].join("\n"),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<style");
    expect(html).toContain("<strong>sicher</strong>");
  });

  test("external links get a scheme check and safe link attributes", () => {
    const html = renderJournalMarkdown(
      "[ok](https://example.org) [mail](mailto:a@b.de) [rel](//evil.example)",
    );
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('href="mailto:a@b.de"');
    expect(html).not.toContain("evil.example");
  });

  test("photo embeds are resolved by the hook or removed", () => {
    const md = "Vor ![Dach](photo:abc-123) nach ![Keller](photo:def-456)";
    const removed = renderJournalMarkdown(md);
    expect(removed).not.toContain("<img");
    expect(removed).not.toContain("photo:");
    const resolved = renderMarkdown(md, {
      resolvePhoto: (id) => (id === "abc-123" ? "/files/abc-123/400.webp" : null),
    });
    expect(resolved).toContain('src="/files/abc-123/400.webp"');
    expect(resolved).not.toContain("def-456");
    // Even a bad resolver cannot smuggle an external URL into an image src.
    const bad = renderMarkdown("![](photo:abc-123)", {
      resolvePhoto: () => "https://evil.example/x.png",
    });
    expect(bad).not.toContain("<img");
  });

  test("excerpts are plain and bounded", () => {
    expect(
      journalExcerpt("**fett** und [Link](https://x.de)  hier", 20).length,
    ).toBeLessThanOrEqual(20);
    expect(journalExcerpt("**fett** und [Link](https://x.de)")).toContain("fett und Link");
    expect(journalExcerpt("![](photo:abc)")).toBe("");
  });
});
