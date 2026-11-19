// v1.3: research is admin only; a search area around a pin is saved and a
// scan request shows up as a run (RESEARCH=off in e2e: the worker skips it).
import { expect, test } from "./fixtures";
import { createLocation, hydrated, token } from "./helpers";

test("members cannot open research", async ({ newUser }) => {
  const member = await newUser("member");
  await member.page.goto("/recherche");
  await hydrated(member.page);
  await expect(member.page.getByText("Seite nicht gefunden.")).toBeVisible();
});

test("admin creates a search area around a pin and requests a scan", async ({
  adminPage: page,
}) => {
  const name = `Zeche ${token()}`;
  const url = await createLocation(page, name);
  await expect(page.getByTestId("start-research")).toBeVisible();

  await page.goto("/recherche");
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "Recherche", exact: true })).toBeVisible();
  await expect(page.getByText("Keine Vorschläge in dieser Ansicht.")).toBeVisible();

  await page.getByRole("link", { name: "Suchgebiete" }).click();
  await hydrated(page);
  await page.getByLabel("Kreis um einen Ort").check();
  await page.getByRole("searchbox", { name: "Ort", exact: true }).fill(name.slice(0, 12));
  await page.getByRole("button", { name: "Wählen" }).first().click();
  await expect(page.getByTestId("area-center")).toHaveText(name);
  await page.getByLabel("Radius in km").fill("3");
  await page.getByRole("button", { name: "Suchgebiet speichern" }).click();
  const card = page
    .getByRole("list", { name: "Suchgebiete" })
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "OpenStreetMap durchsuchen" }).click();
  await expect(page.getByText("Auftrag eingereiht.", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Läufe & Budget" }).click();
  await hydrated(page);
  const run = page.getByRole("list", { name: "Letzte Läufe" }).getByRole("listitem").first();
  await expect(run).toContainText("OpenStreetMap-Scan");
  // The standalone worker must pick it up (RESEARCH=off: skipped, nothing sent).
  await expect(async () => {
    await page.reload();
    await expect(run).toContainText("Übersprungen", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(
    page.getByText("Recherche ist auf diesem Server abgeschaltet", { exact: false }),
  ).toBeVisible();
  expect(url).toContain("/locations/");
});
