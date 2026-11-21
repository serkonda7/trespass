import { Link, useLocation, useNavigate, useRouterState } from "@tanstack/solid-router";
import type { SessionUser } from "@trespass/server/auth/functions";
import { can } from "@trespass/shared/app-actions";
import { m } from "@trespass/shared/paraglide/messages";
import { For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Wordmark } from "~/components/layout/wordmark";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  IconBackpack,
  IconBook,
  IconLogout,
  IconMap,
  IconRoute,
  IconSearch,
  IconSettings,
  IconTelescope,
  IconUser,
} from "~/components/ui/icons";
import { cn } from "~/lib/cn";

type NavItem = {
  to: "/" | "/logbuch" | "/touren" | "/suche" | "/admin";
  label: () => string;
  icon: (props: { class?: string }) => JSX.Element;
  roles?: SessionUser["role"][];
};

// Ausrüstung lives in the user menu (it is personal, and the bottom bar is full).
const NAV: NavItem[] = [
  { to: "/", label: m.nav_map, icon: IconMap },
  { to: "/logbuch", label: m.nav_logbook, icon: IconBook },
  { to: "/touren", label: m.nav_trips, icon: IconRoute },
  { to: "/suche", label: m.nav_search, icon: IconSearch },
  { to: "/admin", label: m.nav_admin, icon: IconSettings, roles: ["admin", "member"] },
];

/** Pages that draw edge to edge under the header (no page padding). */
const FULL_BLEED = new Set(["/"]);

export async function logout() {
  // Loaded on demand: Better Auth's client is only needed here, so it stays
  // out of the JavaScript every signed-in page downloads.
  const { authClient } = await import("~/lib/auth-client");
  await authClient.signOut();
  window.location.assign("/login");
}

/** A thin bar at the top while a navigation waits for its route chunk or data. */
function NavProgress() {
  const pending = useRouterState({ select: (s) => s.status === "pending" });
  return (
    <Show when={pending()}>
      <div
        aria-hidden="true"
        class="tr-nav-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-primary"
      />
    </Show>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

/** Phone-first layout: top bar, content, bottom tab bar (top links from `md`). */
export function AppShell(props: { user: SessionUser; children: JSX.Element }) {
  const location = useLocation();
  const navigate = useNavigate();
  const items = () => NAV.filter((n) => !n.roles || n.roles.includes(props.user.role));
  const isActive = (to: string) =>
    to === "/" ? location().pathname === "/" : location().pathname.startsWith(to);
  const fullBleed = () => FULL_BLEED.has(location().pathname);

  return (
    <div class="flex min-h-dvh flex-col">
      <NavProgress />
      <header class="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md print:hidden">
        <div
          class={cn(
            "mx-auto flex h-[var(--header-h)] items-center gap-6 px-4",
            !fullBleed() && "max-w-5xl",
          )}
        >
          <Link
            to="/"
            class="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wordmark />
          </Link>
          <nav class="hidden h-full flex-1 items-stretch gap-1 md:flex" aria-label={m.nav_menu()}>
            <For each={items()}>
              {(item) => (
                <Link
                  to={item.to}
                  class={cn(
                    "relative flex items-center gap-2 px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground",
                    "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full",
                    isActive(item.to) && "text-foreground after:bg-primary",
                  )}
                  aria-current={isActive(item.to) ? "page" : undefined}
                >
                  <Dynamic component={item.icon} class="size-4" />
                  {item.label()}
                </Link>
              )}
            </For>
          </nav>
          <div class="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                as={Button}
                variant="ghost"
                size="sm"
                class="h-10 gap-2 pl-1.5 pr-2.5"
              >
                <span
                  class="flex size-7 items-center justify-center rounded-full border border-primary/40 bg-primary/15 font-mono text-[0.7rem] font-semibold text-primary"
                  aria-hidden="true"
                >
                  {initials(props.user.displayName)}
                </span>
                <span class="max-w-32 truncate">{props.user.displayName}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>
                  <span class="block">{props.user.displayName}</span>
                  <span class="block font-mono text-xs font-normal text-muted-foreground">
                    @{props.user.username}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <Show when={can(props.user, "research")}>
                  <DropdownMenuItem onSelect={() => navigate({ to: "/recherche" })}>
                    <IconTelescope />
                    {m.nav_research()}
                  </DropdownMenuItem>
                </Show>
                <Show when={can(props.user, "ownEquipment")}>
                  <DropdownMenuItem onSelect={() => navigate({ to: "/ausruestung" })}>
                    <IconBackpack />
                    {m.nav_equipment()}
                  </DropdownMenuItem>
                </Show>
                <DropdownMenuItem onSelect={() => navigate({ to: "/account" })}>
                  <IconUser />
                  {m.account_nav()}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout}>
                  <IconLogout />
                  {m.nav_logout()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main
        class={cn(
          "w-full flex-1",
          fullBleed()
            ? "relative"
            : "mx-auto max-w-5xl px-4 pt-5 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] md:pb-10 print:max-w-none print:p-0",
        )}
      >
        {props.children}
      </main>

      <Show when={items().length > 1}>
        <nav
          class="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
          aria-label={m.nav_menu()}
        >
          <ul class="grid" style={{ "grid-template-columns": `repeat(${items().length}, 1fr)` }}>
            <For each={items()}>
              {(item) => (
                <li>
                  <Link
                    to={item.to}
                    class={cn(
                      "relative flex h-[var(--tabbar-h)] flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold transition-colors",
                      "before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-b-full",
                      isActive(item.to)
                        ? "text-foreground before:bg-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-current={isActive(item.to) ? "page" : undefined}
                  >
                    <Dynamic
                      component={item.icon}
                      class={cn("size-5", isActive(item.to) && "text-primary")}
                    />
                    {item.label()}
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </Show>
    </div>
  );
}
