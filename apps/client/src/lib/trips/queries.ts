// Query options for trips. Writes go through runAction and invalidate ["trips"].
import { queryOptions } from "@tanstack/solid-query";
import { getTripFn, listTripsFn } from "@trespass/server/trips/functions";

export const tripsQuery = (open = false) =>
  queryOptions({
    queryKey: ["trips", "list", { open }],
    queryFn: () => listTripsFn({ data: { open } }),
  });

export const tripQuery = (id: string) =>
  queryOptions({
    queryKey: ["trips", "detail", id],
    queryFn: () => getTripFn({ data: { id } }),
  });
