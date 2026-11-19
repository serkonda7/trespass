// Stage 3: map, location pages and the tile route.
// The exact coordinates in these tests are a canary: a viewer below `precise`
// must never receive them, in the HTML or in the dehydrated query state.
import { expect, test } from "./fixtures";
import { createLocation, hydrated, token } from "./helpers";

test("admin creates a location and sees its exact coordinates and apps", async ({ adminPage }) => {
  const name = `Werk ${token()}`;
  const url = await createLocation(adminPage, name);
  await expect(adminPage).toHaveURL(url);
  await expect(adminPage.getByRole("heading", { name })).toBeVisible();
  await expect(adminPage.getByTestId("location-coordinates")).toHaveText("51.12345, 7.12345");
  await expect(adminPage.getByRole("heading", { name: "Öffnen in …" })).toBeVisible();
  const osmAnd = await adminPage
    .getByRole("link", { name: "Öffnen in OsmAnd" })
    .getAttribute("href");
  expect(osmAnd).toContain("pin=51.12345,7.12345");
  await expect(adminPage.getByRole("link", { name: "Öffnen in Organic Maps" })).toBeVisible();
});

test("a member only sees the fuzzed point after the location is shared", async ({
  adminPage,
  newUser,
}) => {
  const name = `Bunker ${token()}`;
  const url = await createLocation(adminPage, name);
  const member = await newUser("member");

  // Private: no access at all (404, never 403).
  await member.page.goto(url);
  await expect(member.page.getByText("Ort nicht gefunden.")).toBeVisible();

  // Admin shares it at friends/view.
  await adminPage.getByRole("button", { name: "Teilen" }).click();
  const dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("Sichtbarkeit").selectOption("friends");
  await dialog.getByLabel("Stufe für Freunde").selectOption("view");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByLabel("Sichtbarkeit")).toHaveValue("friends");
  await dialog.getByLabel("Schließen").click();

  await member.page.goto(url);
  await hydrated(member.page);
  await expect(member.page.getByRole("heading", { name })).toBeVisible();
  await expect(member.page.getByText("Ungefährer Standort").first()).toBeVisible();
  const html = await member.page.content();
  expect(html).not.toContain("51.12345");
  expect(html).not.toContain("7.12345");
  expect(html).not.toContain("Öffnen in");
});

test("the tile route requires a session", async ({ page, adminPage }) => {
  const anonymous = await page.request.get("/tiles/0/0/0.mvt");
  expect(anonymous.status()).toBe(401);

  // With a session, a missing MBTiles file is a harmless 204.
  const signedIn = await adminPage.request.get("/tiles/0/0/0.mvt");
  expect([200, 204]).toContain(signedIn.status());
});
