import { useInfiniteQuery, useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { VisitCard } from "~/components/visits/visit-card";
import { visitFeedQuery, yearReviewQuery } from "~/lib/visits/queries";

export const Route = createFileRoute("/_authed/logbuch")({
  head: () => ({ meta: [{ title: `${m.logbook_title()} · ${m.app_name()}` }] }),
  loader: async ({ context }) => {
    const year = new Date().getFullYear();
    await Promise.all([
      context.queryClient.ensureInfiniteQueryData(visitFeedQuery({ limit: 20 })),
      context.queryClient.ensureQueryData(yearReviewQuery(year)),
    ]);
  },
  component: LogbookPage,
});

function LogbookPage() {
  const [year, setYear] = createSignal(new Date().getFullYear());
  const feed = useInfiniteQuery(() => visitFeedQuery({ limit: 20 }));
  const review = useQuery(() => yearReviewQuery(year()));
  const rows = createMemo(() => feed.data?.pages.flatMap((p) => p.rows) ?? []);
  const years = Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - i);
  const maxMonth = createMemo(() => Math.max(1, ...(review.data?.months ?? [])));

  return (
    <div class="mx-auto grid max-w-3xl gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-2xl font-semibold">{m.logbook_title()}</h1>
        <Link to="/fotos/unsortiert" class="text-sm text-primary underline underline-offset-4">
          {m.photos_unsorted()}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 class="text-lg font-semibold">{m.logbook_review_title()}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4">
          <div>
            <Label for="review-year">{m.logbook_year()}</Label>
            <select
              id="review-year"
              class={inputClass}
              value={year()}
              onChange={(e) => setYear(Number(e.currentTarget.value))}
            >
              <For each={years}>{(y) => <option value={y}>{y}</option>}</For>
            </select>
          </div>
          <Show when={review.data}>
            {(data) => (
              <>
                <dl class="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt class="text-sm text-muted-foreground">{m.logbook_visits()}</dt>
                    <dd class="text-xl font-semibold">{data().visits}</dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted-foreground">{m.logbook_locations()}</dt>
                    <dd class="text-xl font-semibold">{data().locations}</dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted-foreground">{m.logbook_countries()}</dt>
                    <dd class="text-xl font-semibold">{data().countries}</dd>
                  </div>
                </dl>
                <ul class="grid gap-1" aria-label={m.logbook_review_title()}>
                  <For each={data().months}>
                    {(count, i) => (
                      <li class="flex items-center gap-2 text-xs">
                        <span class="w-8 text-muted-foreground">
                          {new Intl.DateTimeFormat("de-DE", { month: "short" }).format(
                            new Date(2000, i(), 1),
                          )}
                        </span>
                        <span
                          class="h-3 rounded bg-primary"
                          style={{
                            width: `${Math.round((count / maxMonth()) * 100)}%`,
                            "min-width": count ? "3px" : "0",
                          }}
                        />
                        <span>{count}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </>
            )}
          </Show>
        </CardContent>
      </Card>

      <section class="grid gap-3" aria-label={m.logbook_feed_title()}>
        <h2 class="text-lg font-semibold">{m.logbook_feed_title()}</h2>
        <Show
          when={rows().length > 0}
          fallback={
            <Card>
              <CardContent class="pt-4">{m.logbook_feed_empty()}</CardContent>
            </Card>
          }
        >
          <For each={rows()}>{(visit) => <VisitCard visit={visit} showLocation />}</For>
          <Show when={feed.hasNextPage}>
            <Button
              variant="outline"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {m.logbook_more()}
            </Button>
          </Show>
        </Show>
      </section>
    </div>
  );
}
