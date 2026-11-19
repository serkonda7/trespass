// Stage 5: upload, worker processing, gallery and the original-vs-derivative
// rule. A JPEG is generated in the test with sharp, so no binary fixture is
// needed. E2E/server.ts starts the standalone worker against the same DB.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "./fixtures";
import { createLocation, hydrated, token } from "./helpers";

test("admin uploads a photo, friends see the derivative but not the original", async ({
  adminPage,
  newUser,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "trespass-e2e-photo-"));
  const file = join(dir, "dach.jpg");
  await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#416985" },
  })
    .jpeg()
    .toFile(file);

  try {
    const name = `Fotohaus ${token()}`;
    const url = await createLocation(adminPage, name);

    await adminPage.getByRole("tab", { name: "Fotos" }).click();
    await hydrated(adminPage);
    await adminPage.getByTestId("photo-file-input").setInputFiles(file);

    // The worker turns it into WebP derivatives; the gallery polls while it
    // is processing. This timeout also covers a cold worker start.
    const thumb = adminPage.getByTestId("photo-gallery").locator("img").first();
    await expect(thumb).toBeVisible({ timeout: 30_000 });
    await expect(thumb).toHaveAttribute("src", /\/files\/[0-9a-f-]+\?size=400/);
    const src = (await thumb.getAttribute("src"))!;
    const photoId = src.match(/\/files\/([0-9a-f-]+)/)![1]!;

    // The thumbnail element exists while the row is still `processing`, so
    // wait for the worker to finish before asserting the bytes.
    await expect
      .poll(async () => (await adminPage.request.get(`/files/${photoId}?size=1600`)).status(), {
        timeout: 30_000,
      })
      .toBe(200);
    const adminDerivative = await adminPage.request.get(`/files/${photoId}?size=1600`);
    expect(adminDerivative.headers()["content-type"]).toBe("image/webp");

    const member = await newUser("member");
    await adminPage.getByRole("button", { name: "Teilen" }).click();
    const dialog = adminPage.getByRole("dialog");
    await dialog.getByLabel("Sichtbarkeit").selectOption("friends");
    await dialog.getByLabel("Stufe für Freunde").selectOption("view");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await dialog.getByLabel("Schließen").click();

    await member.page.goto(url);
    await hydrated(member.page);
    await expect(member.page.getByRole("heading", { name })).toBeVisible();
    await expect(member.page.getByRole("tab", { name: "Fotos" })).toBeVisible();

    const derivative = await member.page.request.get(`/files/${photoId}?size=400`);
    expect(derivative.status()).toBe(200);
    expect(derivative.headers()["content-type"]).toBe("image/webp");
    const original = await member.page.request.get(`/files/${photoId}?size=original`);
    expect(original.status()).toBe(404);
    const unknown = await member.page.request.get(`/files/does-not-exist?size=400`);
    expect(unknown.status()).toBe(404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
