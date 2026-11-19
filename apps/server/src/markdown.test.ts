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

describe("renderMarkdown (constructive allowlist)", () => {
  test("XSS vectors cannot emit a tag, an event handler or a dangerous scheme", () => {
    const html = renderJournalMarkdown(
      [
        '<script>alert("x")</script>',
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">böse</a>',
        "![x](data:image/svg+xml;base64,PHN2Zz4=)",
        '<iframe src="javascript:alert(1)">evil</iframe>',
        "<style>body{display:none}</style>",
        "**sicher**",
      ].join("\n"),
    );
    for (const needle of [
      "<script",
      "alert",
      "onerror",
      "javascript:",
      "data:",
      "<iframe",
      "<style",
    ])
      expect({ html, needle, found: html.includes(needle) }).toEqual({
        html,
        needle,
        found: false,
      });
    expect(html).toContain("<strong>sicher</strong>");
  });

  test("attribute breakout via quotes is escaped in href, src and alt", () => {
    const link = renderJournalMarkdown('[x](https://example.org/?a="><script>alert(1)</script>)');
    expect(link).toContain('href="https://example.org/?a=&quot;&gt;"');
    expect(link).not.toContain("<script");
    const image = renderMarkdown('![a "q" & b](photo:abc)', {
      resolvePhoto: () => "/files/a&b/400.webp",
    });
    expect(image).toContain('src="/files/a&amp;b/400.webp"');
    expect(image).toContain('alt="a &quot;q&quot; &amp; b"');
  });

  test("entities are decoded once, not double-escaped", () => {
    expect(renderJournalMarkdown("A &amp; B &lt;x&gt;")).toBe("<p>A &amp; B &lt;x&gt;</p>");
    expect(
      renderMarkdown("![a & b](photo:abc)", { resolvePhoto: () => "/files/abc.webp" }),
    ).toContain('alt="a &amp; b"');
  });

  test("constructs from the old allowlist still render", () => {
    expect(renderJournalMarkdown("# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6")).toBe(
      "<p>h1</p><h2>h2</h2><h3>h3</h3><h4>h4</h4><p>h5</p><p>h6</p>",
    );
    expect(renderJournalMarkdown("3. three\n4. four")).toBe(
      '<ol start="3"><li>three</li><li>four</li></ol>',
    );
    expect(renderJournalMarkdown("- [x] done\n- [ ] todo")).toBe(
      "<ul><li>done</li><li>todo</li></ul>",
    );
    expect(renderJournalMarkdown("| a | b |\n| :- | -: |\n| 1 | 2 |")).toContain(
      '<th align="left">a</th>',
    );
    expect(renderJournalMarkdown("```js\nconst x = 1 < 2 && 3 > 2;\n```")).toContain(
      "<pre><code>const x = 1 &lt; 2 &amp;&amp; 3 &gt; 2;",
    );
    expect(renderJournalMarkdown("[ok](https://example.org) mail a@b.de")).toContain(
      'href="mailto:a@b.de"',
    );
  });
});
