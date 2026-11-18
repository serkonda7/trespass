// TanStack Query options for photo lists (loaders warm them, pages read them).
import { queryOptions } from "@tanstack/solid-query";
import { listPhotosFn } from "~/server/photos/functions";
import type { ListPhotosInput } from "./inputs";

export const photosQueryKey = (input: ListPhotosInput) => ["photos", "list", input] as const;

export const photosQuery = (input: ListPhotosInput) =>
  queryOptions({
    queryKey: photosQueryKey(input),
    queryFn: () => listPhotosFn({ data: input }),
    refetchOnWindowFocus: false,
  });

export const unsortedPhotosQuery = () => photosQuery({ unsorted: true, limit: 2000 });
