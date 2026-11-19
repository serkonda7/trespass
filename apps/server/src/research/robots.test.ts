import { describe, expect, test } from "bun:test";
import { parseRobots, robotsAllows } from "./robots";

describe("robots.txt", () => {
  const body = `
User-agent: *
Disallow: /private/
Allow: /private/ok.html
Disallow: /*.pdf$

User-agent: ResearchBot
User-agent: other
Disallow: /
`;

  test("our own group wins over *", () => {
    const rules = parseRobots(body, "researchbot");
    expect(robotsAllows(rules, "/anything")).toBe(false);
  });

  test("* group with allow/disallow and wildcards", () => {
    const rules = parseRobots(body, "somebot");
    expect(robotsAllows(rules, "/public")).toBe(true);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
    expect(robotsAllows(rules, "/private/ok.html")).toBe(true);
    expect(robotsAllows(rules, "/doc.pdf")).toBe(false);
    expect(robotsAllows(rules, "/doc.pdf?x=1")).toBe(true);
  });

  test("empty robots allows everything", () => {
    expect(robotsAllows(parseRobots("", "x"), "/a")).toBe(true);
  });
});
