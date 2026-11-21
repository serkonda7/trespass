import { useInfiniteQuery, useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { m } from "@trespass/shared/paraglide/messages";
import { createMemo, createSignal, For, Show } from "solid-js";
import { EmptyState, PageColumn, PageHeader } from "~/components/layout/page-header";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { IconBook, IconPhoto } from "~/components/ui/icons";
import { inputClass } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { VisitCard } from "~/components/visits/visit-card";
import { cn } from "~/lib/cn";
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

  const monthName = (i: number) =>
    new Intl.DateTimeFormat("de-DE", { month: "short" }).format(new Date(2000, i, 1));

  return (
    <PageColumn>
      <PageHeader
        title={m.logbook_title()}
        actions={
          <Link to="/fotos/unsortiert" class={buttonVariants({ variant: "outline", size: "sm" })}>
            <IconPhoto />
            {m.photos_unsorted()}
          </Link>
        }
      />

      <Card>
        <CardHeader class="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2 class="section-title">{m.logbook_review_title()}</h2>
          </CardTitle>
          <div class="flex items-center gap-2">
            <Label for="review-year" class="kicker">
              {m.logbook_year()}
            </Label>
            <select
              id="review-year"
              class={cn(inputClass, "h-9 w-auto py-1 font-mono text-sm")}
              value={year()}
              onChange={(e) => setYear(Number(e.currentTarget.value))}
            >
              <For each={years}>{(y) => <option value={y}>{y}</option>}</For>
            </select>
          </div>
        </CardHeader>
        <CardContent class="grid gap-4">
          <Show when={review.data}>
            {(data) => (
              <>
                <dl class="grid grid-cols-3 divide-x rounded-lg border bg-background/40">
                  <For
                    each={
                      [
                        [m.logbook_visits(), data().visits],
                        [m.logbook_locations(), data().locations],
                        [m.logbook_countries(), data().countries],
                      ] as const
                    }
                  >
                    {([label, value]) => (
                      <div class="grid gap-1 px-3 py-3">
                        <dt class="kicker">{label}</dt>
                        <dd class="font-mono text-3xl font-semibold leading-none tabular-nums">
                          {value}
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
                <ul
                  class="grid h-32 grid-cols-12 items-end gap-1.5"
                  aria-label={m.logbook_review_title()}
                >
                  <For each={data().months}>
                    {(count, i) => (
                      // Reversed column: the month reads first, then its count.
                      <li class="flex h-full flex-col-reverse items-center justify-start gap-1">
                        <span class="font-mono text-[0.6rem] uppercase text-muted-foreground">
                          {monthName(i()).slice(0, 3)}
                        </span>
                        <span
                          class={cn("w-full rounded-t-sm", count ? "bg-primary" : "bg-border")}
                          style={{
                            height: count
                              ? `${Math.max(6, Math.round((count / maxMonth()) * 80))}%`
                              : "2px",
                          }}
                          aria-hidden="true"
                        />
                        <span
                          class={cn(
                            "font-mono text-[0.65rem] tabular-nums",
                            count ? "text-foreground" : "sr-only",
                          )}
                        >
                          {count}
                        </span>
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
        <h2 class="section-title">{m.logbook_feed_title()}</h2>
        <Show
          when={rows().length > 0}
          fallback={<EmptyState icon={<IconBook />}>{m.logbook_feed_empty()}</EmptyState>}
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
    </PageColumn>
  );
}
