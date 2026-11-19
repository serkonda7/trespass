import { expect, type Page } from "@playwright/test";

/** Waits until the app has hydrated (input before that is lost). */
export const hydrated = (page: Page) =>
  page.locator("html[data-hydrated]").waitFor({ state: "attached" });

/** A short unique token for names and searches. */
export function token(): string {
  return `x${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")}`;
}

/** Fills the create-location form and returns the detail URL. */
export async function createLocation(
  page: Page,
  name: string,
  coords = "51.12345, 7.12345",
): Promise<string> {
  await page.goto("/locations/new");
  await hydrated(page);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Kategorie").selectOption({ label: "Industrie" });
  await page.getByLabel("Koordinaten").fill(coords);
  await page.getByRole("button", { name: "Neuen Ort anlegen" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]{36}$/);
  return page.url();
}

/** Opens the location's "Besuche" tab and fills a visit with a journal text. */
export async function addVisit(page: Page, journalMd: string): Promise<void> {
  await hydrated(page);
  await page.getByRole("tab", { name: "Besuche" }).click();
  await page.getByTestId("add-visit").click();
  await expect(page).toHaveURL(/\/visits\/new\?location=/);
  await hydrated(page);
  await page.getByLabel("Tagebuch (Markdown)").fill(journalMd);
  await page.getByRole("button", { name: "Besuch eintragen", exact: true }).last().click();
}
