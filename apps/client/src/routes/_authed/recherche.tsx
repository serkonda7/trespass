import { createFileRoute, Link, notFound, Outlet, useLocation } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import { m } from "@trespass/shared/paraglide/messages";
import { For } from "solid-js";
import { cn } from "~/lib/cn";

// Research (DESIGN §6, §11): admin only, because it reveals which areas the
// admin is interested in. Everyone else gets a 404; the server functions
// check the role again.
export const Route = createFileRoute("/_authed/recherche")({
  beforeLoad: ({ context }) => {
    if (!can(context.user, "research")) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.research_title()} · ${m.app_name()}` }] }),
  component: ResearchLayout,
});

const TABS = [
  { to: "/recherche", label: m.research_tab_inbox, exact: true },
  { to: "/recherche/gebiete", label: m.research_tab_areas, exact: false },
  { to: "/recherche/laeufe", label: m.research_tab_runs, exact: false },
] as const;

function ResearchLayout() {
  const location = useLocation();
  const active = (t: (typeof TABS)[number]) => {
    const path = location().pathname.replace(/\/$/, "");
    return t.exact ? path === t.to : path.startsWith(t.to);
  };
  return (
    <div class="grid gap-4">
      <div class="grid gap-1">
        <h1 class="text-2xl font-semibold">{m.research_title()}</h1>
        <p class="text-sm text-muted-foreground">{m.research_intro()}</p>
      </div>
      <nav aria-label={m.research_tabs()} class="-mx-4 overflow-x-auto px-4">
        <ul class="flex gap-1 border-b">
          <For each={TABS}>
            {(t) => (
              <li>
                <Link
                  to={t.to}
                  class={cn(
                    "-mb-px inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium",
                    active(t)
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={active(t) ? "page" : undefined}
                >
                  {t.label()}
                </Link>
              </li>
            )}
          </For>
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
