// End-to-end search: the FTS index is updated synchronously on create and the
// Suche page finds a German compound via its diacritic-free spelling.
import { expect, test } from "./fixtures";
import { createLocation, hydrated, token } from "./helpers";

test("search finds a location by 'heilstatte'", async ({ adminPage }) => {
  const unique = token();
  const name = `Lungenheilstätte ${unique}`;
  await createLocation(adminPage, name);

  await adminPage.goto("/suche");
  await hydrated(adminPage);
  await expect(adminPage.getByRole("heading", { name: "Suche" })).toBeVisible();
  await adminPage.getByLabel("Orte durchsuchen").fill(`heilstatte ${unique}`);
  await expect(adminPage).toHaveURL(/q=heilstatte/);
  await expect(adminPage.getByRole("link", { name, exact: true })).toBeVisible();
});

test("search shows an empty state for an unknown term", async ({ adminPage }) => {
  await adminPage.goto("/suche");
  await hydrated(adminPage);
  await adminPage.getByLabel("Orte durchsuchen").fill(`unbekannt${token()}`);
  await expect(
    adminPage.getByText("Keine Treffer. Versuche einen anderen Suchbegriff."),
  ).toBeVisible();
});
