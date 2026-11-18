// Admin settings page: the instance singleton and its validation.
import { expect, test } from "./fixtures";

test("admin changes the instance settings", async ({ adminPage: page }) => {
  await page.goto("/admin/settings");
  const name = page.getByLabel("Name der Instanz");
  const budget = page.getByLabel("Forschungsbudget (Cent)");
  const tiles = page.getByLabel("Karten-Budget (MB)");
  const fuzz = page.getByLabel("Standard-Unschärfe (m)");
  await expect(name).toHaveValue("Trespass");
  await expect(tiles).toHaveValue("10240");
  await expect(fuzz).toHaveValue("1500");

  await name.fill("Mein Trespass");
  await budget.fill("500");
  await tiles.fill("2048");
  await fuzz.fill("800");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert")).toBeVisible();

  await page.reload();
  await expect(name).toHaveValue("Mein Trespass");
  await expect(budget).toHaveValue("500");
  await expect(tiles).toHaveValue("2048");
  await expect(fuzz).toHaveValue("800");

  // Server-side validation answers with the specific German text.
  await name.fill("   ");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Bitte einen Namen mit 1 bis 80 Zeichen eingeben.")).toBeVisible();

  // Leave the defaults behind for other tests.
  await name.fill("Trespass");
  await budget.fill("0");
  await tiles.fill("10240");
  await fuzz.fill("1500");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert").last()).toBeVisible();
});
