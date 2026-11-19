// The "Teilen" dialog: visibility + friends_level and per-user/group grants.
// The server owns all decisions; this component only offers the controls and
// renders the serialized grant list (present only at manage level).
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import {
  removeLocationGrantFn,
  setLocationGrantFn,
  setLocationVisibilityFn,
} from "@trespass/server/locations/functions";
import { grantLevelSchema } from "@trespass/shared/locations/inputs";
import type {
  GrantRow,
  LocationGrantLevel,
  SerializedLocation,
} from "@trespass/shared/locations/types";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { locationQuery, principalsQuery } from "~/lib/locations/queries";
import { levelLabel } from "~/lib/locations/status";
import { runAction } from "~/lib/run-action";

const LEVELS = grantLevelSchema.options;
const GUEST_LEVELS: readonly LocationGrantLevel[] = ["view", "contribute"];

export function LocationSharing(props: {
  location: SerializedLocation;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meId: string;
}) {
  const qc = useQueryClient();
  const principals = useQuery(() => principalsQuery());
  const [visibility, setVisibility] = createSignal(props.location.visibility);
  const [friendsLevel, setFriendsLevel] = createSignal(props.location.friendsLevel);
  const [target, setTarget] = createSignal("");
  const [level, setLevel] = createSignal<LocationGrantLevel>("view");
  const [busy, setBusy] = createSignal(false);

  const grants = () => props.location.grants ?? [];
  const taken = () => new Set(grants().map((g) => `${g.principalKind}:${g.principalId}`));
  const candidates = createMemo(() =>
    (principals.data ?? []).filter(
      (p) =>
        !(p.kind === "user" && (p.id === props.meId || p.id === props.location.ownerId)) &&
        !taken().has(`${p.kind}:${p.id}`),
    ),
  );

  const version = () => {
    const cached = qc.getQueryData(locationQuery(props.location.id).queryKey) as
      | { location: SerializedLocation }
      | undefined;
    return cached?.location.version ?? props.location.version;
  };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["locations", "detail", props.location.id] });
  };

  const saveVisibility = async () => {
    setBusy(true);
    const r = await runAction(
      () =>
        setLocationVisibilityFn({
          data: {
            id: props.location.id,
            version: version(),
            visibility: visibility(),
            friendsLevel: friendsLevel(),
          },
        }),
      { success: m.location_visibility_saved() },
    );
    setBusy(false);
    if (r) await refresh();
  };

  const add = async () => {
    const token = target();
    const i = token.indexOf(":");
    if (i < 1) return;
    const principalKind = token.slice(0, i) as "user" | "group";
    const principalId = token.slice(i + 1);
    setBusy(true);
    const r = await runAction(
      () =>
        setLocationGrantFn({
          data: { locationId: props.location.id, principalKind, principalId, level: level() },
        }),
      { success: m.location_share_added() },
    );
    setBusy(false);
    if (r) {
      setTarget("");
      await refresh();
    }
  };

  const remove = async (g: GrantRow) => {
    setBusy(true);
    const r = await runAction(
      () =>
        removeLocationGrantFn({
          data: {
            locationId: props.location.id,
            principalKind: g.principalKind,
            principalId: g.principalId,
          },
        }),
      { success: m.location_share_removed() },
    );
    setBusy(false);
    if (r) await refresh();
  };

  const levelsFor = () => {
    const chosen = candidates().find((p) => `${p.kind}:${p.id}` === target());
    return chosen?.role === "guest" ? GUEST_LEVELS : LEVELS;
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.location_share_title()}</DialogTitle>
          <DialogDescription>{m.location_share_hint()}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-4">
          <div class="grid gap-2">
            <Label for="share-visibility">{m.location_field_visibility()}</Label>
            <select
              id="share-visibility"
              class={inputClass}
              value={visibility()}
              onChange={(e) => setVisibility(e.currentTarget.value as "private" | "friends")}
            >
              <option value="private">{m.location_visibility_private()}</option>
              <option value="friends">{m.location_visibility_friends()}</option>
            </select>
            <Show when={visibility() === "friends"}>
              <Label for="share-friends-level">{m.location_field_friends_level()}</Label>
              <select
                id="share-friends-level"
                class={inputClass}
                value={friendsLevel()}
                onChange={(e) =>
                  setFriendsLevel(e.currentTarget.value as "view" | "contribute" | "precise")
                }
              >
                <option value="view">{m.location_friends_level_view()}</option>
                <option value="contribute">{m.location_friends_level_contribute()}</option>
                <option value="precise">{m.location_friends_level_precise()}</option>
              </select>
            </Show>
            <Button variant="outline" disabled={busy()} onClick={saveVisibility}>
              {m.common_save()}
            </Button>
          </div>

          <section class="grid gap-2" aria-label={m.location_share_title()}>
            <h3 class="font-semibold">{m.location_share_title()}</h3>
            <Show
              when={grants().length === 0}
              fallback={
                <ul class="grid gap-2">
                  <For each={grants()}>
                    {(g) => (
                      <li class="flex items-center justify-between gap-2 text-sm">
                        <span>
                          {g.principalName}{" "}
                          <span class="text-muted-foreground">({levelLabel(g.level)})</span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy()}
                          onClick={() => remove(g)}
                        >
                          {m.location_share_remove()}
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              }
            >
              <p class="text-sm text-muted-foreground">{m.location_grants_empty()}</p>
            </Show>

            <Show
              when={candidates().length === 0}
              fallback={
                <div class="grid gap-2">
                  <Label for="share-principal">{m.location_choose_principal()}</Label>
                  <select
                    id="share-principal"
                    class={inputClass}
                    value={target()}
                    onChange={(e) => {
                      setTarget(e.currentTarget.value);
                      const chosen = candidates().find(
                        (p) => `${p.kind}:${p.id}` === e.currentTarget.value,
                      );
                      if (chosen?.role === "guest") setLevel("view");
                    }}
                  >
                    <option value="">{m.location_choose_principal()}</option>
                    <optgroup label={m.location_group()}>
                      <For each={candidates().filter((p) => p.kind === "group")}>
                        {(p) => <option value={`${p.kind}:${p.id}`}>{p.name}</option>}
                      </For>
                    </optgroup>
                    <optgroup label={m.location_person()}>
                      <For each={candidates().filter((p) => p.kind === "user")}>
                        {(p) => (
                          <option value={`${p.kind}:${p.id}`}>
                            {p.name} {p.detail}
                          </option>
                        )}
                      </For>
                    </optgroup>
                  </select>
                  <Label for="share-level">{m.location_share_grant_level()}</Label>
                  <select
                    id="share-level"
                    class={inputClass}
                    value={level()}
                    onChange={(e) => setLevel(e.currentTarget.value as LocationGrantLevel)}
                  >
                    <For each={levelsFor()}>
                      {(l) => <option value={l}>{levelLabel(l)}</option>}
                    </For>
                  </select>
                  <Button variant="outline" disabled={busy() || !target()} onClick={add}>
                    {m.location_share_add()}
                  </Button>
                </div>
              }
            >
              <p class="text-sm text-muted-foreground">{m.location_principals_empty()}</p>
            </Show>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            {m.common_close()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
