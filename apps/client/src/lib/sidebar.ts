// The desktop sidebar's collapsed state lives in a cookie, not localStorage,
// so the server renders the rail at the right width and hydration matches.
import { createIsomorphicFn } from "@tanstack/solid-start";
import { getCookie } from "@tanstack/solid-start/server";

const COOKIE = "tr_sidebar";

export const readSidebarCollapsed = createIsomorphicFn()
  .server(() => getCookie(COOKIE) === "collapsed")
  .client(() => document.cookie.split("; ").includes(`${COOKIE}=collapsed`));

export function writeSidebarCollapsed(collapsed: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain UI preference, read on the server too.
  document.cookie = `${COOKIE}=${collapsed ? "collapsed" : "open"}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
