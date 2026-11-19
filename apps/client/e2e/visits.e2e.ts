// Stage 4: visits and journal. The journal contains a script tag that must be
// stripped by the server-side sanitizer before it reaches the browser.
import { expect, test } from "./fixtures";
import { addVisit, createLocation, hydrated, token } from "./helpers";

test("a visit shows bold journal text, no script and appears in the logbook", async ({
  adminPage,
}) => {
  const name = `Werk ${token()}`;
  const url = await createLocation(adminPage, name);
  await addVisit(adminPage, "**fett** <script>window.__trespassXss = 1</script>");
  await expect(adminPage).toHaveURL(url);

  await adminPage.getByRole("tab", { name: "Besuche" }).click();
  await expect(adminPage.getByTestId("visit-journal").locator("strong")).toHaveText("fett");
  const html = await adminPage.content();
  expect(html).not.toContain("<script>window.__trespassXss");
  expect(
    await adminPage.evaluate(() => (window as { __trespassXss?: boolean }).__trespassXss),
  ).toBeUndefined();

  // The derived status shows up on the location header.
  await expect(adminPage.getByText("Besucht", { exact: true }).first()).toBeVisible();

  await adminPage.goto("/logbuch");
  await hydrated(adminPage);
  await expect(adminPage.getByRole("heading", { name: "Logbuch" })).toBeVisible();
  await expect(adminPage.getByTestId("visit-card").filter({ hasText: name })).toBeVisible();
  await expect(adminPage.getByTestId("visit-journal").locator("strong")).toHaveText("fett");
});
