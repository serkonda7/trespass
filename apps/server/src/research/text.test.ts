import { describe, expect, test } from "bun:test";
import { extractText } from "./text";

describe("extractText", () => {
  test("drops scripts and keeps the article text", () => {
    const html = `<html><head><title>Zeche Ewald</title><script>alert("x")</script></head>
      <body><nav>Menü Startseite</nav><article><h1>Zeche Ewald</h1>
      <p>Die Zeche wurde 1871 abgeteuft und 2000 stillgelegt. Heute ist das Gelände ein Gewerbepark.</p>
      <p>Weitere Informationen zur Geschichte des Bergbaus im Ruhrgebiet finden sich im Archiv.</p></article></body></html>`;
    const r = extractText(html, "text/html");
    expect(r.text).toContain("2000 stillgelegt");
    expect(r.text).not.toContain("alert");
  });

  test("plain text passes through", () => {
    expect(extractText("a  \n\n\n\nb", "text/plain").text).toBe("a\n\nb");
  });
});
