import { createFileRoute, notFound, Outlet, useLocation } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { PageHeader } from "~/components/layout/page-header";
import { SectionNav } from "~/components/layout/section-nav";
import { ADMIN_AREA_ROLES, sectionsFor } from "~/lib/admin-sections";

// Admin area layout with section navigation. Guests cannot open it; members
// see only the sections their role allows (see ~/lib/admin-sections.ts).
// Each section route guards itself too, and its server functions check roles.
export const Route = createFileRoute("/_authed/admin")({
  beforeLoad: ({ context }) => {
    if (!ADMIN_AREA_ROLES.includes(context.user.role)) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.admin_nav_title()} · ${m.app_name()}` }] }),
  component: AdminLayout,
});

function AdminLayout() {
  const ctx = Route.useRouteContext();
  const location = useLocation();
  const sections = () => sectionsFor(ctx().user.role);
  const active = (to: string) => location().pathname.startsWith(to);
  return (
    <div class="mx-auto grid w-full max-w-5xl gap-5">
      <PageHeader title={m.admin_nav_title()} />
      <SectionNav label={m.admin_nav_sections()} items={sections()} isActive={active} />
      <Outlet />
    </div>
  );
}
