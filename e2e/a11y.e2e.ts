// Automated accessibility pass (axe, WCAG 2.x A/AA rules) over the foundation
// pages, plus a check that none of them scrolls sideways at phone width.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { hydrated } from "./helpers";

async function audit(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = r.violations.map(
    (v) => `${path}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
  // Phone layout: the page itself must never scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
}

test("foundation pages have no axe violations", async ({ adminPage, newUser }) => {
  for (const path of ["/", "/account"]) await audit(adminPage, path);
  const guest = await newUser("guest");
  for (const path of ["/admin/users", "/admin/invites", "/admin/groups", "/admin/settings"]) {
    await guest.page.goto(path);
    await hydrated(guest.page);
    await expect(guest.page.getByText("Seite nicht gefunden.")).toBeVisible();
  }
  await audit(guest.page, "/login");
});
