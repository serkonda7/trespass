import type { Page } from "@playwright/test";

/** Waits until the app has hydrated (input before that is lost). */
export const hydrated = (page: Page) =>
  page.locator("html[data-hydrated]").waitFor({ state: "attached" });

/** A short unique token for names and searches. */
export function token(): string {
  return `x${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")}`;
}
