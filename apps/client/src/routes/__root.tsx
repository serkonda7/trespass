/// <reference types="vite/client" />
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { type JSX, onMount } from "solid-js";
import { HydrationScript } from "solid-js/web";
import { Toaster } from "~/components/ui/toast";
import { markHydrated } from "~/lib/hydrated";
import { sessionQuery } from "~/lib/session-query";
import type { RouterContext } from "~/router";
import appCss from "~/styles/app.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  // `context.user` (SessionUser | null) from the cached session, refreshed in the
  // background when stale. An ended session surfaces as 401 → /login.
  beforeLoad: async ({ context }) => ({
    user: await context.queryClient.ensureQueryData({ ...sessionQuery(), revalidateIfStale: true }),
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#141311" },
      { title: m.app_name() },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // No favicon yet: an empty data URL stops every browser from requesting
      // /favicon.ico, which would render a full 404 page on the server.
      { rel: "icon", href: "data:," },
    ],
  }),
  notFoundComponent: () => (
    <main class="mx-auto grid max-w-3xl justify-items-start gap-3 p-4">
      <p>{m.error_not_found()}</p>
      {/* A plain link: works even when the page failed before hydration. */}
      <a href="/" class="text-primary underline underline-offset-4">
        {m.error_back_home()}
      </a>
    </main>
  ),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
});

function RootDocument(props: { children: JSX.Element }) {
  // Every page, including login and invite (outside the app shell).
  onMount(markHydrated);
  return (
    <html lang="de">
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body class="min-h-dvh antialiased">
        {props.children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
