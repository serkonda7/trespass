// TEMPORARY: screenshots for the UI rework. Not committed.
import { test } from "./fixtures";
import { addVisit, createLocation, hydrated, token } from "./helpers";

const DIR = process.env.SHOTS_DIR ?? "/tmp/shots";
const TAG = process.env.SHOTS_TAG ?? "shot";

test("screenshots", async ({ adminPage: p }) => {
  test.setTimeout(120_000);
  const shot = async (name: string, full = true) => {
    await hydrated(p);
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${DIR}/${TAG}-${name}.png`, fullPage: full });
  };
  const url = await createLocation(p, `Zeche Zollern ${token()}`);
  await p.goto(url);
  await addVisit(p, "Erster Besuch. **Dach** eingestürzt.");
  await p.goto(url);
  await shot("location");
  await p.goto("/");
  await shot("map", false);
  await p.goto("/logbuch");
  await shot("logbuch");
  await p.goto("/");
  await hydrated(p);
  await p.getByRole("banner").getByRole("button").last().click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${DIR}/${TAG}-menu.png` });
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto(url);
  await shot("desktop-location");
});
