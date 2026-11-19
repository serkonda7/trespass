// Admin-only server functions for research (DESIGN §6). Requesting a scan or
// an enrich run only creates the run and enqueues its job; the worker does
// all outbound work. The services check the role again.
import { createServerFn } from "@tanstack/solid-start";
import {
  areaIdInput,
  createAreaInput,
  decideCandidateInput,
  listCandidatesInput,
  startEnrichInput,
  startScanInput,
  updateAreaInput,
} from "@trespass/shared/research/inputs";
import { roleMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { createArea, deleteArea, listAreas, updateArea } from "./areas";
import {
  decideCandidate,
  listCandidates,
  requestEnrich,
  requestScan,
  researchOverview,
} from "./inbox";

const admin = roleMiddleware("admin");

export const listAreasFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .handler(({ context: { ctx } }) => listAreas(getDb(), ctx));

export const createAreaFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(createAreaInput)
  .handler(({ context: { ctx }, data }) => createArea(getDb(), ctx, data));

export const updateAreaFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(updateAreaInput)
  .handler(({ context: { ctx }, data }) => updateArea(getDb(), ctx, data));

export const deleteAreaFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(areaIdInput)
  .handler(({ context: { ctx }, data }) => {
    deleteArea(getDb(), ctx, data.id);
    return { ok: true as const };
  });

export const startScanFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(startScanInput)
  .handler(({ context: { ctx }, data }) => requestScan(getDb(), ctx, data));

export const startEnrichFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(startEnrichInput)
  .handler(({ context: { ctx }, data }) => requestEnrich(getDb(), ctx, data));

export const listCandidatesFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(listCandidatesInput)
  .handler(({ context: { ctx }, data }) => listCandidates(getDb(), ctx, data));

export const decideCandidateFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(decideCandidateInput)
  .handler(({ context: { ctx }, data }) => decideCandidate(getDb(), ctx, data));

export const researchOverviewFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .handler(({ context: { ctx } }) => researchOverview(getDb(), ctx));
