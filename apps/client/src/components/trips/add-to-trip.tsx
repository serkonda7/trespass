// "Zur Tour hinzufügen" on a location page: pick one of the caller's open
// trips, or start a new one with this location as its first stop.
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link } from "@tanstack/solid-router";
import { addTripStopFn } from "@trespass/server/trips/functions";
import { formatIsoDay } from "@trespass/shared/format";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, For, Show } from "solid-js";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { runAction } from "~/lib/run-action";
import { tripsQuery } from "~/lib/trips/queries";

export function AddToTripDialog(props: {
  locationId: string;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const trips = useQuery(() => ({ ...tripsQuery(true), enabled: props.open }));
  const mine = createMemo(() => (trips.data ?? []).filter((t) => t.isOwner || props.isAdmin));

  const add = async (tripId: string) => {
    const r = await runAction(
      () => addTripStopFn({ data: { tripId, locationId: props.locationId } }),
      { success: (x) => (x.added ? m.trips_stop_added() : m.trips_stop_already()) },
    );
    if (r) {
      await qc.invalidateQueries({ queryKey: ["trips"] });
      props.onOpenChange(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.trips_add_to()}</DialogTitle>
          <DialogDescription>{m.trips_add_to_hint()}</DialogDescription>
        </DialogHeader>
        <Show
          when={mine().length > 0}
          fallback={<p class="text-sm text-muted-foreground">{m.trips_none_open()}</p>}
        >
          <ul class="grid gap-2">
            <For each={mine()}>
              {(t) => (
                <li>
                  <Button
                    variant="outline"
                    class="w-full justify-between"
                    onClick={() => add(t.id)}
                  >
                    <span>{t.title}</span>
                    <span class="text-xs text-muted-foreground">
                      {t.startsOn ? formatIsoDay(t.startsOn) : ""}
                    </span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Link
          to="/touren/new"
          search={{ location: props.locationId }}
          class={buttonVariants({ variant: "default" })}
        >
          {m.trips_new_with_location()}
        </Link>
      </DialogContent>
    </Dialog>
  );
}
