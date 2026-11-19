// v1.1: history with sources, and threaded comments on a location.
import { expect, test } from "./fixtures";
import { createLocation, hydrated, token } from "./helpers";

test("an editor adds a dated history entry with a source; it becomes searchable", async ({
  adminPage: page,
}) => {
  const name = `Heilstätte ${token()}`;
  const fact = `Brand${token()}`;
  await createLocation(page, name);
  await page.getByRole("tab", { name: "Geschichte" }).click();
  await page.getByTestId("add-history").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Genauigkeit").selectOption("year");
  await dialog.getByLabel("Datum").fill("1923");
  await dialog.getByLabel("Was ist passiert?").fill(`${fact} im Ostflügel`);
  await dialog.getByRole("button", { name: "Quelle hinzufügen" }).click();
  await dialog.getByLabel("Adresse der Quelle").fill("https://example.org/chronik");
  await dialog.getByLabel("Titel (optional)").fill("Chronik");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  const entry = page.getByTestId("history-entry");
  await expect(entry).toContainText("1923");
  await expect(entry).toContainText(`${fact} im Ostflügel`);
  await expect(entry.getByRole("link", { name: "Chronik" })).toHaveAttribute(
    "href",
    "https://example.org/chronik",
  );

  // The timeline shows it too, and search finds the location by the history text.
  await page.getByRole("tab", { name: "Besuche" }).click();
  await expect(page.getByTestId("history-entry")).toContainText(fact);
  await page.goto(`/suche?q=${encodeURIComponent(fact.toLowerCase())}`);
  await hydrated(page);
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("comments thread on a shared location; guests read but cannot write", async ({
  adminPage,
  newUser,
}) => {
  const name = `Bahnhof ${token()}`;
  const url = await createLocation(adminPage, name);
  await adminPage.getByRole("button", { name: "Teilen" }).click();
  const share = adminPage.getByRole("dialog");
  await share.getByLabel("Sichtbarkeit").selectOption("friends");
  await share.getByRole("button", { name: "Speichern" }).click();
  await expect(share.getByLabel("Sichtbarkeit")).toHaveValue("friends");
  await adminPage.keyboard.press("Escape");

  const member = await newUser("member");
  await member.page.goto(url);
  await hydrated(member.page);
  await member.page.getByRole("tab", { name: "Kommentare" }).click();
  await member.page.getByPlaceholder("Kommentar schreiben …").fill("Seiteneingang **offen**?");
  await member.page.getByRole("button", { name: "Kommentieren" }).click();
  await expect(member.page.getByTestId("comment").locator("strong").last()).toHaveText("offen");

  await adminPage.reload();
  await hydrated(adminPage);
  await adminPage.getByRole("tab", { name: "Kommentare" }).click();
  await adminPage.getByRole("button", { name: "Antworten" }).click();
  await adminPage.getByPlaceholder(/Antwort an/).fill("Ja, links hinten");
  await adminPage.getByRole("button", { name: "Antworten" }).last().click();
  await expect(adminPage.getByTestId("comment")).toHaveCount(2);

  const guest = await newUser("guest");
  await guest.page.goto(url);
  await hydrated(guest.page);
  await guest.page.getByRole("tab", { name: "Kommentare" }).click();
  await expect(guest.page.getByText("Ja, links hinten")).toBeVisible();
  await expect(guest.page.getByPlaceholder("Kommentar schreiben …")).toHaveCount(0);
});
