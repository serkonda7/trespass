// v1.1: equipment, packing templates, trips with a route preview.
import { expect, test } from "./fixtures";
import { createLocation, hydrated, token } from "./helpers";

test("equipment goes into a template, the template into a trip's packing list", async ({
  adminPage: page,
}) => {
  const lamp = `Stirnlampe ${token()}`;
  await page.goto("/ausruestung");
  await hydrated(page);
  await page.getByTestId("add-equipment").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(lamp);
  await dialog.getByLabel("Kategorie").selectOption("light");
  await dialog.getByLabel("Gewicht (g, optional)").fill("90");
  await dialog.getByLabel("Laden").check();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByTestId("equipment-item").filter({ hasText: lamp })).toBeVisible();

  const templateName = `Nacht ${token()}`;
  await page.getByPlaceholder("Name der neuen Vorlage").fill(templateName);
  await page.getByRole("button", { name: "Vorlage anlegen" }).click();
  const template = page.getByTestId("pack-template").filter({ hasText: templateName });
  await template.locator("summary").click();
  await template.getByRole("checkbox", { name: lamp }).check();
  await expect(template.locator("summary")).toContainText("1 Teile");

  // Two locations become the stops of a new trip.
  const first = `Zeche ${token()}`;
  const second = `Kokerei ${token()}`;
  await createLocation(page, second, "51.20000, 7.20000");
  const firstUrl = await createLocation(page, first, "51.10000, 7.10000");
  await page.getByTestId("add-to-trip").click();
  await page.getByRole("link", { name: "Neue Tour mit diesem Ort" }).click();
  await expect(page).toHaveURL(/\/touren\/new\?location=/);
  await hydrated(page);
  const title = `Ruhr ${token()}`;
  await page.getByLabel("Titel").fill(title);
  await page.getByRole("button", { name: "Tour anlegen" }).click();
  await expect(page).toHaveURL(/\/touren\/[0-9a-f-]{36}$/);
  const tripUrl = page.url();
  await expect(page.getByTestId("trip-stops")).toContainText(first);

  // Add the second stop from its location page.
  await page.goto("/suche");
  await hydrated(page);
  await page.getByLabel("Orte durchsuchen").fill(second);
  await page.getByRole("link", { name: second }).click();
  await hydrated(page);
  await page.getByTestId("add-to-trip").click();
  await page.getByRole("dialog").getByRole("button", { name: title }).click();
  await expect(page.getByText("Zur Tour hinzugefügt.")).toBeVisible();

  await page.goto(tripUrl);
  await hydrated(page);
  await expect(page.getByTestId("trip-stops").getByRole("listitem")).toHaveCount(2);
  // About 13 km as the crow flies; both points are exact for the admin.
  await expect(page.getByTestId("route-total")).toContainText(/1\d,\d km/);
  await expect(page.getByTestId("route-total")).not.toContainText("≈");

  const packing = page.getByTestId("packing-list");
  await packing.getByLabel("Packvorlage wählen").selectOption({ label: templateName });
  await packing.getByRole("button", { name: "Übernehmen" }).click();
  const item = packing.getByRole("checkbox", { name: lamp });
  await expect(item).toBeVisible();
  await item.check();
  await expect(packing).toContainText("1 von 1 gepackt");
  await page.reload();
  await hydrated(page);
  await expect(
    page.getByTestId("packing-list").getByRole("checkbox", { name: lamp }),
  ).toBeChecked();
  expect(firstUrl).toContain("/locations/");
});

test("a person on the trip sees only the stops visible to them, fuzzed", async ({
  adminPage,
  newUser,
}) => {
  const member = await newUser("member");
  const shared = `Geteilt ${token()}`;
  const secret = `Geheim ${token()}`;
  await createLocation(adminPage, secret, "52.00000, 8.00000");
  await createLocation(adminPage, shared, "51.12345, 7.12345");
  await adminPage.getByRole("button", { name: "Teilen" }).click();
  const share = adminPage.getByRole("dialog");
  await share.getByLabel("Sichtbarkeit").selectOption("friends");
  await share.getByRole("button", { name: "Speichern" }).click();
  await expect(share.getByLabel("Sichtbarkeit")).toHaveValue("friends");
  await adminPage.keyboard.press("Escape");

  await adminPage.getByTestId("add-to-trip").click();
  await adminPage.getByRole("link", { name: "Neue Tour mit diesem Ort" }).click();
  await hydrated(adminPage);
  const title = `Gemeinsam ${token()}`;
  await adminPage.getByLabel("Titel").fill(title);
  await adminPage.getByRole("button", { name: "Person hinzufügen" }).click();
  await adminPage.getByLabel("Person wählen …").selectOption({ label: member.displayName });
  await adminPage.getByRole("button", { name: "Tour anlegen" }).click();
  await expect(adminPage).toHaveURL(/\/touren\/[0-9a-f-]{36}$/);
  const tripUrl = adminPage.url();

  // The private location is added as a second stop.
  await adminPage.goto("/suche");
  await hydrated(adminPage);
  await adminPage.getByLabel("Orte durchsuchen").fill(secret);
  await adminPage.getByRole("link", { name: secret }).click();
  await hydrated(adminPage);
  await adminPage.getByTestId("add-to-trip").click();
  await adminPage.getByRole("dialog").getByRole("button", { name: title }).click();
  await expect(adminPage.getByText("Zur Tour hinzugefügt.")).toBeVisible();

  await member.page.goto("/touren");
  await hydrated(member.page);
  await member.page.getByRole("link", { name: title }).click();
  await hydrated(member.page);
  const stops = member.page.getByTestId("trip-stops");
  await expect(stops.getByRole("listitem")).toHaveCount(1);
  await expect(stops).toContainText(shared);
  await expect(stops).toContainText("Ungefährer Standort");
  const html = await member.page.content();
  expect(html).not.toContain(secret);
  expect(html).not.toContain("51.12345");
  expect(member.page.url()).toBe(tripUrl);
});
