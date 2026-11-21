import { m } from "@trespass/shared/paraglide/messages";
import { cn } from "~/lib/cn";

/** The app mark: a hazard-striped tag. Decorative; the wordmark carries the name. */
export function AppMark(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={cn("size-6", props.class)} aria-hidden="true">
      <defs>
        <clipPath id="tr-mark-clip">
          <rect x="2" y="5" width="20" height="14" rx="2.5" />
        </clipPath>
      </defs>
      <rect x="2" y="5" width="20" height="14" rx="2.5" fill="var(--primary)" />
      <g clip-path="url(#tr-mark-clip)" stroke="var(--primary-foreground)" stroke-width="2.6">
        <path d="M-2 21 L10 3 M5 21 L17 3 M12 21 L24 3 M19 21 L31 3" />
      </g>
    </svg>
  );
}

export function Wordmark(props: { class?: string }) {
  return (
    <span class={cn("flex items-center gap-2", props.class)}>
      <AppMark />
      <span class="text-[1.05rem] font-extrabold uppercase leading-none tracking-[0.14em] [font-stretch:75%]">
        {m.app_name()}
      </span>
    </span>
  );
}
