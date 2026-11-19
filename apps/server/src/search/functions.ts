// Server function for the Suche page. The map uses listLocationsFn, which
// delegates to the same searchLocations query; both AND the visibility
// predicate in SQL and return serialized LocationListItems.
import { createServerFn } from "@tanstack/solid-start";
import { listLocationsInput } from "@trespass/shared/locations/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { searchLocations } from "./query";

export const searchLocationsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listLocationsInput)
  .handler(({ context: { ctx }, data }) => searchLocations(getDb(), ctx, data));
