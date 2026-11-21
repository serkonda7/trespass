import { createFileRoute, notFound, Outlet, useLocation } from "@tanstack/solid-router";
import { can } from "@trespass/shared/app-actions";
import { m } from "@trespass/shared/paraglide/messages";
import { PageHeader } from "~/components/layout/page-header";
import { SectionNav } from "~/components/layout/section-nav";

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
    <div class="mx-auto grid w-full max-w-5xl gap-4">
      <PageHeader title={m.research_title()} description={m.research_intro()} />
      <SectionNav
        label={m.research_tabs()}
        items={TABS}
        isActive={(to) => active(TABS.find((t) => t.to === to)!)}
      />
      <Outlet />
    </div>
  );
}
