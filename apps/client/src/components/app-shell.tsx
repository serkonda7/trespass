import * as DialogPrimitive from "@kobalte/core/dialog";
import { Link, useLocation, useNavigate, useRouterState } from "@tanstack/solid-router";
import type { SessionUser } from "@trespass/server/auth/functions";
import { type AppAction, can } from "@trespass/shared/app-actions";
import { m } from "@trespass/shared/paraglide/messages";
import { children, createEffect, createSignal, For, type JSX, on, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { AppMark, Wordmark } from "~/components/layout/wordmark";
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
  IconChevronsLeft,
  IconChevronsRight,
  IconLayoutDashboard,
  IconLogout,
  IconMap,
  IconMenu2,
  IconPhoto,
  IconPlus,
  IconRoute,
  IconSearch,
  IconSettings,
  IconTelescope,
  IconUser,
  IconX,
} from "~/components/ui/icons";
import { cn } from "~/lib/cn";
import { writeSidebarCollapsed } from "~/lib/sidebar";

type Path =
  | "/"
  | "/map"
  | "/logbuch"
  | "/touren"
  | "/suche"
  | "/ausruestung"
  | "/fotos/unsortiert"
  | "/recherche"
  | "/admin";

type NavItem = {
  to: Path;
  label: () => string;
  icon: (props: { class?: string }) => JSX.Element;
  /** Who sees the entry: an app action, or a list of roles. */
  action?: AppAction;
  roles?: SessionUser["role"][];
  /** Further path prefixes that highlight this entry (detail pages). */
  also?: string[];
  /** Quick "+" next to the entry. */
  add?: { to: "/locations/new" | "/touren/new"; label: () => string; action: AppAction };
};

type NavGroup = { label?: () => string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    items: [
      { to: "/", label: m.nav_dashboard, icon: IconLayoutDashboard },
      {
        to: "/map",
        label: m.nav_map,
        icon: IconMap,
        also: ["/locations"],
        add: { to: "/locations/new", label: m.nav_new_location, action: "createLocation" },
      },
      { to: "/suche", label: m.nav_search, icon: IconSearch },
    ],
  },
  {
    label: m.nav_group_explore,
    items: [
      { to: "/logbuch", label: m.nav_logbook, icon: IconBook, also: ["/visits"] },
      {
        to: "/touren",
        label: m.nav_trips,
        icon: IconRoute,
        add: { to: "/touren/new", label: m.trips_new, action: "createTrip" },
      },
      { to: "/ausruestung", label: m.nav_equipment, icon: IconBackpack, action: "ownEquipment" },
      {
        to: "/fotos/unsortiert",
        label: m.photos_unsorted,
        icon: IconPhoto,
        roles: ["admin", "member"],
      },
    ],
  },
  {
    label: m.nav_group_tools,
    items: [
      { to: "/recherche", label: m.nav_research, icon: IconTelescope, action: "research" },
      { to: "/admin", label: m.nav_admin, icon: IconSettings, roles: ["admin", "member"] },
    ],
  },
];

/** Pages that draw edge to edge next to the sidebar (no page padding). */
const FULL_BLEED = new Set(["/map"]);

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

const visible = (user: SessionUser, item: { action?: AppAction; roles?: SessionUser["role"][] }) =>
  (!item.action || can(user, item.action)) && (!item.roles || item.roles.includes(user.role));

/**
 * The grouped navigation, shared by the desktop sidebar and the phone drawer.
 * Collapsed (desktop rail), labels move to sr-only text and a tooltip, group
 * labels become dividers and the quick-add buttons are hidden.
 */
function SidebarNav(props: { user: SessionUser; collapsed?: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const groups = () =>
    NAV.map((g) => ({ ...g, items: g.items.filter((i) => visible(props.user, i)) })).filter(
      (g) => g.items.length > 0,
    );
  const isActive = (item: NavItem) => {
    const path = location().pathname;
    return [item.to, ...(item.also ?? [])].some((p) => path === p || path.startsWith(`${p}/`));
  };

  return (
    <nav
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3 [scrollbar-width:thin]"
      aria-label={m.nav_main()}
    >
      <For each={groups()}>
        {(group) => (
          <div class="grid gap-0.5">
            <Show when={group.label}>
              {(label) => (
                <>
                  {/* Collapsed, the label stays for screen readers behind a divider. */}
                  <Show when={props.collapsed}>
                    <span class="mx-2 mb-1.5 border-t" aria-hidden="true" />
                  </Show>
                  <p class={props.collapsed ? "sr-only" : "kicker px-2.5 pb-1"}>{label()()}</p>
                </>
              )}
            </Show>
            <For each={group.items}>
              {(item) => (
                <div
                  class={cn(
                    "group/item relative flex items-center rounded-md transition-colors",
                    isActive(item)
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Show when={isActive(item)}>
                    <span
                      class="absolute inset-y-1.5 -left-2.5 w-0.5 rounded-r-full bg-primary"
                      aria-hidden="true"
                    />
                  </Show>
                  <Link
                    to={item.to}
                    class={cn(
                      "flex h-10 min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      props.collapsed && "justify-center px-0",
                    )}
                    aria-current={isActive(item) ? "page" : undefined}
                    title={props.collapsed ? item.label() : undefined}
                    onClick={() => props.onNavigate?.()}
                  >
                    <Dynamic
                      component={item.icon}
                      class={cn("size-5 shrink-0", isActive(item) && "text-primary")}
                    />
                    <span class={props.collapsed ? "sr-only" : "truncate"}>{item.label()}</span>
                  </Link>
                  <Show when={!props.collapsed && item.add && can(props.user, item.add.action)}>
                    <Link
                      to={item.add?.to ?? "/"}
                      class="mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/item:opacity-100 md:focus-visible:opacity-100"
                      aria-label={item.add?.label()}
                      title={item.add?.label()}
                      onClick={() => props.onNavigate?.()}
                    >
                      <IconPlus class="size-4" />
                    </Link>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </nav>
  );
}

/** Phone navigation: a modal drawer from the left (focus trap, Escape, overlay click). */
function NavDrawer(props: {
  user: SessionUser;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay class="tr-animate-fade fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] md:hidden" />
        <DialogPrimitive.Content class="tr-animate-drawer fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/50 md:hidden">
          <div class="flex h-[var(--header-h)] shrink-0 items-center justify-between border-b pl-4 pr-2">
            <Wordmark />
            <DialogPrimitive.CloseButton
              class="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={m.common_close()}
            >
              <IconX class="size-5" />
            </DialogPrimitive.CloseButton>
          </div>
          <DialogPrimitive.Title class="sr-only">{m.nav_main()}</DialogPrimitive.Title>
          <SidebarNav user={props.user} onNavigate={() => props.onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function UserMenu(props: { user: SessionUser }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger as={Button} variant="ghost" size="sm" class="h-10 gap-2 pl-1.5 pr-2.5">
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
  );
}

/**
 * Header on top (brand, user menu), a sticky sidebar on the left from `md`
 * (collapsible to an icon rail, remembered in a cookie) and a drawer behind
 * the menu button on phones.
 */
export function AppShell(props: {
  user: SessionUser;
  sidebarCollapsed: boolean;
  children: JSX.Element;
}) {
  const location = useLocation();
  // Resolved once: the page is placed in one of two wrappers below.
  const page = children(() => props.children);
  const [collapsed, setCollapsed] = createSignal(props.sidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const fullBleed = () => FULL_BLEED.has(location().pathname);
  const toggle = () => {
    const next = !collapsed();
    setCollapsed(next);
    writeSidebarCollapsed(next);
  };
  // Back/forward or a link inside a page also closes the drawer.
  createEffect(
    on(
      () => location().pathname,
      () => setDrawerOpen(false),
      { defer: true },
    ),
  );

  return (
    <div class="flex min-h-dvh flex-col">
      <NavProgress />
      <header class="sticky top-0 z-40 flex h-[var(--header-h)] shrink-0 items-center border-b bg-background/90 backdrop-blur-md print:hidden">
        <Button
          variant="ghost"
          size="icon"
          class="ml-2 size-10 md:hidden"
          aria-label={m.nav_open()}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen()}
          onClick={() => setDrawerOpen(true)}
        >
          <IconMenu2 class="size-5" />
        </Button>
        {/* As wide as the sidebar below it, so its border runs the full height. */}
        <div
          class={cn(
            "flex h-full shrink-0 items-center px-3 transition-[width] duration-150 md:border-r md:px-4",
            collapsed()
              ? "md:w-[var(--sidebar-rail)] md:justify-center md:px-0"
              : "md:w-[var(--sidebar-w)]",
          )}
        >
          <Link
            to="/"
            class="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={collapsed() ? m.app_name() : undefined}
          >
            <Wordmark class={cn(collapsed() && "md:hidden")} />
            <Show when={collapsed()}>
              <AppMark class="hidden md:block" />
            </Show>
          </Link>
        </div>
        <div class="ml-auto flex items-center gap-1 pr-2">
          <UserMenu user={props.user} />
        </div>
      </header>

      <div class="flex flex-1">
        <aside
          class={cn(
            "sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] shrink-0 flex-col border-r bg-card/40 transition-[width] duration-150 md:flex print:hidden",
            collapsed() ? "w-[var(--sidebar-rail)]" : "w-[var(--sidebar-w)]",
          )}
        >
          <SidebarNav user={props.user} collapsed={collapsed()} />
          <div class={cn("border-t p-2.5", collapsed() && "flex justify-center")}>
            <button
              type="button"
              class={cn(
                "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed() ? "w-10 justify-center px-0" : "w-full",
              )}
              aria-expanded={!collapsed()}
              aria-label={collapsed() ? m.nav_expand() : undefined}
              title={collapsed() ? m.nav_expand() : undefined}
              onClick={toggle}
            >
              <Show when={collapsed()} fallback={<IconChevronsLeft class="size-5 shrink-0" />}>
                <IconChevronsRight class="size-5 shrink-0" />
              </Show>
              <Show when={!collapsed()}>
                <span class="truncate">{m.nav_collapse()}</span>
              </Show>
            </button>
          </div>
        </aside>

        <main class={cn("min-w-0 flex-1", fullBleed() && "relative")}>
          <Show when={!fullBleed()} fallback={page()}>
            <div class="mx-auto w-full max-w-5xl px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] md:px-8 md:pt-7 print:max-w-none print:p-0">
              {page()}
            </div>
          </Show>
        </main>
      </div>

      <NavDrawer user={props.user} open={drawerOpen()} onOpenChange={setDrawerOpen} />
    </div>
  );
}
