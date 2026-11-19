// Query options for history entries. Writes go through runAction and
// invalidate ["history"] plus the location timeline and search.
import { queryOptions } from "@tanstack/solid-query";
import { listHistoryFn } from "@trespass/server/history/functions";

export const historyQuery = (locationId: string) =>
  queryOptions({
    queryKey: ["history", locationId],
    queryFn: () => listHistoryFn({ data: { locationId } }),
  });
