import { createFileRoute } from "@tanstack/solid-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { m } from "~/paraglide/messages";

// Placeholder home page. Later stages add the map (Karte) here (DESIGN §5.1).
export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: `${m.app_name()}` }] }),
  component: Home,
});

function Home() {
  return (
    <Card class="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 class="text-2xl font-semibold">{m.home_hello()}</h1>
        </CardTitle>
        <CardDescription>{m.home_placeholder()}</CardDescription>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground">{m.home_map_soon()}</p>
      </CardContent>
    </Card>
  );
}
