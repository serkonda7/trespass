// Shared query options. Loaders warm them; pages read them. Writes go through
// runAction and invalidate the matching keys.
import { infiniteQueryOptions, queryOptions } from "@tanstack/solid-query";
import {
  getLocationTimelineFn,
  getVisitFn,
  listFeedFn,
  listVisitsForLocationFn,
  yearReviewFn,
} from "~/server/visits/functions";
import type { FeedInput } from "./inputs";

export const visitQuery = (id: string) =>
  queryOptions({
    queryKey: ["visits", "detail", id],
    queryFn: () => getVisitFn({ data: { id } }),
  });

export const locationVisitsQuery = (locationId: string) =>
  queryOptions({
    queryKey: ["visits", "location", locationId],
    queryFn: () => listVisitsForLocationFn({ data: { locationId } }),
  });

export const locationTimelineQuery = (locationId: string) =>
  queryOptions({
    queryKey: ["visits", "timeline", locationId],
    queryFn: () => getLocationTimelineFn({ data: { locationId } }),
  });

export const visitFeedQuery = (input: Omit<FeedInput, "cursor">) =>
  infiniteQueryOptions({
    queryKey: ["visits", "feed", input],
    queryFn: ({ pageParam }) => listFeedFn({ data: { ...input, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const yearReviewQuery = (year: number) =>
  queryOptions({
    queryKey: ["visits", "year", year],
    queryFn: () => yearReviewFn({ data: { year } }),
  });
