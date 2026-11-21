// Query options for the dashboard. It summarises writes made on every other
// page, so instead of invalidating it everywhere it refetches on each visit.
import { queryOptions } from "@tanstack/solid-query";
import { getDashboardFn } from "@trespass/server/dashboard/functions";

export const dashboardQuery = () =>
  queryOptions({
    queryKey: ["dashboard"],
    queryFn: () => getDashboardFn(),
    staleTime: 0,
  });
