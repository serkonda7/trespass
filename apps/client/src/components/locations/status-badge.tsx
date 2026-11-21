import type { LocationStatus } from "@trespass/shared/locations/types";
import { cn } from "~/lib/cn";
import { statusColor, statusLabel } from "~/lib/locations/status";

/** Status as a coloured dot plus a mono label, the same everywhere. */
export function StatusBadge(props: { status: LocationStatus; class?: string }) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase leading-none tracking-wide whitespace-nowrap",
        props.class,
      )}
      style={{
        color: statusColor(props.status),
        "border-color": `color-mix(in oklch, ${statusColor(props.status)} 45%, transparent)`,
        "background-color": `color-mix(in oklch, ${statusColor(props.status)} 10%, transparent)`,
      }}
    >
      <span
        class="size-1.5 rounded-full"
        style={{ "background-color": statusColor(props.status) }}
        aria-hidden="true"
      />
      {statusLabel(props.status)}
    </span>
  );
}
