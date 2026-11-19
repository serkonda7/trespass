// Server functions for trips. Logic and permission checks live in
// ./service.ts; these add authMiddleware and input validation.
import { createServerFn } from "@tanstack/solid-start";
import {
  addChecklistItemInput,
  addTemplateToTripInput,
  checklistItemInput,
  createTripInput,
  listTripsInput,
  setPackedInput,
  setTripStopsInput,
  tripIdInput,
  tripStopInput,
  updateTripInput,
} from "@trespass/shared/trips/inputs";
import { authMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import {
  addChecklistItem,
  addTemplateToTrip,
  addTripStop,
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  removeChecklistItem,
  removeTripStop,
  setChecklistPacked,
  setTripStops,
  updateTrip,
} from "./service";

const ok = { ok: true as const };

export const listTripsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(listTripsInput)
  .handler(({ context: { ctx }, data }) => listTrips(getDb(), ctx, data));

export const getTripFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(tripIdInput)
  .handler(({ context: { ctx }, data }) => getTrip(getDb(), ctx, data.id));

export const createTripFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createTripInput)
  .handler(({ context: { ctx }, data }) => createTrip(getDb(), ctx, data));

export const updateTripFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(updateTripInput)
  .handler(({ context: { ctx }, data }) => updateTrip(getDb(), ctx, data));

export const deleteTripFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(tripIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteTrip(getDb(), ctx, data.id);
    return ok;
  });

export const setTripStopsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(setTripStopsInput)
  .handler(({ context: { ctx }, data }) => setTripStops(getDb(), ctx, data));

export const addTripStopFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(tripStopInput)
  .handler(({ context: { ctx }, data }) => addTripStop(getDb(), ctx, data));

export const removeTripStopFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(tripStopInput)
  .handler(({ context: { ctx }, data }) => {
    removeTripStop(getDb(), ctx, data);
    return ok;
  });

export const addChecklistItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(addChecklistItemInput)
  .handler(({ context: { ctx }, data }) => addChecklistItem(getDb(), ctx, data));

export const addTemplateToTripFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(addTemplateToTripInput)
  .handler(({ context: { ctx }, data }) => addTemplateToTrip(getDb(), ctx, data));

export const setChecklistPackedFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(setPackedInput)
  .handler(({ context: { ctx }, data }) => {
    setChecklistPacked(getDb(), ctx, data);
    return ok;
  });

export const removeChecklistItemFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(checklistItemInput)
  .handler(({ context: { ctx }, data }) => {
    removeChecklistItem(getDb(), ctx, data.id);
    return ok;
  });
