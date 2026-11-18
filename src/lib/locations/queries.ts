// Shared query options: loaders warm them, pages read them. Server functions are
// never called directly from components except through runAction for writes.
import { queryOptions } from "@tanstack/solid-query";
import {
  findDuplicatesFn,
  getLocationFn,
  listCategoriesFn,
  listLocationGrantsFn,
  listLocationsFn,
  listPrincipalsFn,
} from "~/server/locations/functions";
import { searchLocationsFn } from "~/server/search/functions";
import type { FindDuplicatesInput, ListLocationsInput } from "./inputs";

export const locationQuery = (id: string) =>
  queryOptions({
    queryKey: ["locations", "detail", id],
    queryFn: () => getLocationFn({ data: { id } }),
  });

export const locationListQuery = (input: ListLocationsInput) =>
  queryOptions({
    queryKey: ["locations", "list", input],
    queryFn: () => listLocationsFn({ data: input }),
    // The map's bbox query already refetches on moveend; a window-focus
    // refetch would otherwise cause surprise requests (and 401 redirects).
    refetchOnWindowFocus: false,
  });

/** Full-text search results for the Suche page (same row shape as the map list). */
export const locationSearchQuery = (input: ListLocationsInput) =>
  queryOptions({
    queryKey: ["locations", "search", input],
    queryFn: () => searchLocationsFn({ data: input }),
    refetchOnWindowFocus: false,
  });

export const categoriesQuery = () =>
  queryOptions({
    queryKey: ["locations", "categories"],
    queryFn: () => listCategoriesFn(),
    staleTime: 5 * 60_000,
  });

export const principalsQuery = () =>
  queryOptions({
    queryKey: ["locations", "principals"],
    queryFn: () => listPrincipalsFn(),
    staleTime: 5 * 60_000,
  });

export const locationGrantsQuery = (id: string) =>
  queryOptions({
    queryKey: ["locations", "grants", id],
    queryFn: () => listLocationGrantsFn({ data: { id } }),
  });

export const duplicatesQuery = (input: FindDuplicatesInput) =>
  queryOptions({
    queryKey: ["locations", "duplicates", input],
    queryFn: () => findDuplicatesFn({ data: input }),
  });
