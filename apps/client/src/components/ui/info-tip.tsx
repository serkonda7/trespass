// A small "i" after a field label that shows a hint on hover or focus (a tap
// focuses the button on phones). Shown by CSS alone, so it also works before
// hydration on devices that focus tapped buttons. The tip is positioned against
// the nearest `relative` ancestor (the label row), so it never overflows the field. The
// hint keeps its id so the field can reference it with aria-describedby.
import { m } from "@trespass/shared/paraglide/messages";
import { IconInfoCircle } from "~/components/ui/icons";

export function InfoTip(props: { id: string; text: string }) {
  return (
    <span class="group inline-flex">
      <button
        type="button"
        class="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={m.common_info()}
        aria-describedby={props.id}
        // iOS Safari does not focus a tapped button; focus drives the tip.
        onClick={(e) => e.currentTarget.focus()}
      >
        <IconInfoCircle class="size-4" />
      </button>
      <span
        id={props.id}
        role="tooltip"
        class="invisible absolute top-full left-0 z-50 mt-2 w-max max-w-[min(20rem,100%)] rounded-md border bg-popover p-3 text-sm font-normal leading-snug text-popover-foreground opacity-0 shadow-xl shadow-black/40 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {props.text}
      </span>
    </span>
  );
}
