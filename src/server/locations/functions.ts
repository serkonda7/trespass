// Server functions for locations. Logic, permission checks and events live in
// ./service.ts; these add auth (authMiddleware) and input validation.
// Errors: LocationsError codes (src/lib/locations/errors.ts; locationsErrorText
// for German). No UI in this stage — these are the API the map/forms will use.
import { createServerFn } from "@tanstack/solid-start";
import {
  createLocationInput,
  findDuplicatesInput,
  grantInput,
  listLocationsInput,
  locationIdInput,
  locationRefInput,
  moveLocationInput,
  removeGrantInput,
  setVisibilityInput,
  updateLocationInput,
} from "~/lib/locations/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { listCategories } from "./categories";
import {
  createLocation,
  deleteLocation,
  findDuplicates,
  getLocation,
  listLocationGrants,
  listLocations,
  moveLocation,
  removeLocationGrant,
  setLocationGrant,
  setVisibility,
  updateLocation,
} from "./service";

/** Admin/member. Returns { id, version }. */
export const createLocationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createLocationInput)
  .handler(({ context: { ctx }, data }) => createLocation(getDb(), ctx, data));

/** LocationDetail (view); serialized by the service. */
export const getLocationFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(locationIdInput)
  .handler(({ context: { ctx }, data }) => getLocation(getDb(), ctx, data.id));

/** Patch at edit. Returns { version }. */
export const updateLocationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateLocationInput)
  .handler(({ context: { ctx }, data }) => updateLocation(getDb(), ctx, data));

/** Exact point at edit. Returns { version }. */
export const moveLocationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(moveLocationInput)
  .handler(({ context: { ctx }, data }) => moveLocation(getDb(), ctx, data));

/** Manage. Returns { version }. */
export const setLocationVisibilityFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(setVisibilityInput)
  .handler(({ context: { ctx }, data }) => setVisibility(getDb(), ctx, data));

/** Manage. GrantRow[]. */
export const listLocationGrantsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(locationIdInput)
  .handler(({ context: { ctx }, data }) => listLocationGrants(getDb(), ctx, data.id));

/** Manage. Adds or changes a grant; returns GrantRow[]. */
export const setLocationGrantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(grantInput)
  .handler(({ context: { ctx }, data }) => setLocationGrant(getDb(), ctx, data));

/** Manage. Returns GrantRow[]. */
export const removeLocationGrantFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(removeGrantInput)
  .handler(({ context: { ctx }, data }) => removeLocationGrant(getDb(), ctx, data));

/** Manage. */
export const deleteLocationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(locationRefInput)
  .handler(({ context: { ctx }, data }) => {
    deleteLocation(getDb(), ctx, data.id);
    return { ok: true as const };
  });

/** List of visible locations (map, filters, paging). */
export const listLocationsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listLocationsInput)
  .handler(({ context: { ctx }, data }) => listLocations(getDb(), ctx, data));

/** Nearby / similar-name candidates for the create form. */
export const findDuplicatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(findDuplicatesInput)
  .handler(({ context: { ctx }, data }) => findDuplicates(getDb(), ctx, data));

/** The ten seeded categories. */
export const listCategoriesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listCategories(getDb()));
