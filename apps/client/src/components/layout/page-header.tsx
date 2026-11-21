import { children, type JSX, Show } from "solid-js";
import { cn } from "~/lib/cn";

// Slot props (kicker, description, actions, icon) are resolved once with
// `children()`: reading a JSX prop twice (e.g. in <Show when> and its body)
// would create the element twice and break hydration.

/**
 * The top of a page: an optional mono kicker, the condensed title (always the
 * page's only <h1>), an optional description and right-aligned actions.
 */
export function PageHeader(props: {
  title: JSX.Element;
  kicker?: JSX.Element;
  description?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
}) {
  const kicker = children(() => props.kicker);
  const description = children(() => props.description);
  const actions = children(() => props.actions);
  return (
    <div class={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", props.class)}>
      <div class="grid min-w-0 gap-1.5">
        <Show when={kicker.toArray().length > 0}>
          <p class="kicker">{kicker()}</p>
        </Show>
        <h1 class="page-title">{props.title}</h1>
        <Show when={description.toArray().length > 0}>
          <p class="max-w-prose text-sm text-muted-foreground">{description()}</p>
        </Show>
      </div>
      <Show when={actions.toArray().length > 0}>
        <div class="flex flex-wrap items-center gap-2">{actions()}</div>
      </Show>
    </div>
  );
}

/** Narrow, centred page column used by most pages. */
export function PageColumn(props: { children: JSX.Element; class?: string; wide?: boolean }) {
  return (
    <div
      class={cn("mx-auto grid w-full gap-5", props.wide ? "max-w-5xl" : "max-w-3xl", props.class)}
    >
      {props.children}
    </div>
  );
}

/** A quiet placeholder on survey-grid paper for empty lists. */
export function EmptyState(props: { icon?: JSX.Element; children: JSX.Element; class?: string }) {
  const icon = children(() => props.icon);
  return (
    <div
      class={cn(
        "grid-paper flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground",
        props.class,
      )}
    >
      <Show when={icon.toArray().length > 0}>
        <span class="text-muted-foreground [&_svg]:size-6" aria-hidden="true">
          {icon()}
        </span>
      </Show>
      <div>{props.children}</div>
    </div>
  );
}
