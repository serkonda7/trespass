// Location server functions: authMiddleware + input validation over ./service.ts.
// Errors: LocationsError codes (shared/locations/errors.ts).
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
} from "@trespass/shared/locations/inputs";
import { authMiddleware, roleMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { listCategories } from "./categories";
import {
  createLocation,
  deleteLocation,
  findDuplicates,
  getLocation,
  listLocationGrants,
  listLocations,
  listPrincipals,
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

/** Active users and groups for the sharing picker (admin/member). */
export const listPrincipalsFn = createServerFn({ method: "GET" })
  .middleware([roleMiddleware("admin", "member")])
  .handler(() => listPrincipals(getDb()));
