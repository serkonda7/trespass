import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { updateSettingsFn } from "@trespass/server/settings/functions";
import { m } from "@trespass/shared/paraglide/messages";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { settingsQuery } from "~/lib/admin-queries";
import { guardSection } from "~/lib/admin-sections";
import { runAction } from "~/lib/run-action";

export const Route = createFileRoute("/_authed/admin/settings")({
  beforeLoad: ({ context }) => guardSection(context.user.role, "/admin/settings"),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery()),
  head: () => ({ meta: [{ title: `${m.admin_nav_settings()} · ${m.app_name()}` }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery(() => settingsQuery());

  async function onSave(e: SubmitEvent) {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const result = await runAction(
      () =>
        updateSettingsFn({
          data: {
            instanceName: String(data.get("instanceName") ?? ""),
            researchBudgetCents: Number(data.get("researchBudgetCents") ?? 0),
            tileBudgetMb: Number(data.get("tileBudgetMb") ?? 10240),
            defaultFuzzM: Number(data.get("defaultFuzzM") ?? 1500),
          },
        }),
      { success: m.admin_settings_saved() },
    );
    if (result) await qc.invalidateQueries({ queryKey: ["admin", "settings"] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{m.admin_nav_settings()}</h2>
        </CardTitle>
        <CardDescription>{m.admin_settings_intro()}</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid max-w-md gap-4" onSubmit={onSave}>
          <div class="grid gap-2">
            <Label for="settings-name">{m.admin_settings_instance_name()}</Label>
            <Input
              id="settings-name"
              name="instanceName"
              maxLength={80}
              required
              value={settings.data?.instanceName ?? "Trespass"}
            />
          </div>
          <div class="grid gap-2">
            <Label for="settings-budget">{m.admin_settings_research_budget()}</Label>
            <Input
              id="settings-budget"
              name="researchBudgetCents"
              type="number"
              min="0"
              step="1"
              required
              value={settings.data?.researchBudgetCents ?? 0}
            />
          </div>
          <div class="grid gap-2">
            <Label for="settings-tiles">{m.admin_settings_tile_budget()}</Label>
            <Input
              id="settings-tiles"
              name="tileBudgetMb"
              type="number"
              min="1"
              step="1"
              required
              value={settings.data?.tileBudgetMb ?? 10240}
            />
          </div>
          <div class="grid gap-2">
            <Label for="settings-fuzz">{m.admin_settings_default_fuzz()}</Label>
            <Input
              id="settings-fuzz"
              name="defaultFuzzM"
              type="number"
              min="0"
              step="1"
              required
              value={settings.data?.defaultFuzzM ?? 1500}
            />
          </div>
          <div>
            <Button type="submit">{m.common_save()}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
