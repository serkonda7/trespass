// Admin downloads the ZIP export from /admin/export (DESIGN §5.10).
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "./fixtures";

test("admin downloads a ZIP with the documented files", async ({ adminPage: page }) => {
  await page.goto("/admin/export");
  await expect(page.getByRole("heading", { name: "Daten exportieren" })).toBeVisible();
  await expect(page.getByText(/Schätzung:/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^trespass-export_\d{4}-\d\d-\d\d_\d\d-\d\d\.zip$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const files = unzipSync(new Uint8Array(readFileSync(path!)));
  const names = Object.keys(files);
  expect(names).toContain("locations.geojson");
  expect(names).toContain("manifest.json");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
  expect(manifest.formatVersion).toBe(1);
  expect(manifest.scope).toBe("all");
  const geojson = JSON.parse(strFromU8(files["locations.geojson"]!));
  expect(geojson.type).toBe("FeatureCollection");
  expect(Array.isArray(geojson.features)).toBe(true);
});
