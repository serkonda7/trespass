// Query options for the research pages (admin only). Writes go through
// runAction and invalidate ["research"].
import { infiniteQueryOptions, queryOptions } from "@tanstack/solid-query";
import {
  listAreasFn,
  listCandidatesFn,
  researchOverviewFn,
} from "@trespass/server/research/functions";
import type { ListCandidatesInput } from "@trespass/shared/research/inputs";

export const researchAreasQuery = () =>
  queryOptions({ queryKey: ["research", "areas"], queryFn: () => listAreasFn() });

export const researchOverviewQuery = () =>
  queryOptions({ queryKey: ["research", "overview"], queryFn: () => researchOverviewFn() });

export const candidatesQuery = (input: Omit<ListCandidatesInput, "cursor">) =>
  infiniteQueryOptions({
    queryKey: ["research", "candidates", input],
    queryFn: ({ pageParam }) => listCandidatesFn({ data: { ...input, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
  });
