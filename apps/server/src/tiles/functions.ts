// Admin-only server functions for tile regions. They only ENQUEUE jobs: the
// worker does all extraction and writes tiles.sqlite (DESIGN §10).
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { roleMiddleware } from "../auth/middleware";
import { getDb } from "../db/client";
import { getEnv } from "../env";
import { enqueueJob } from "../jobs/queue";
import { DELETE_JOB, EXTRACT_JOB, WORLD_JOB } from "./kinds";
import { listAdminTileRegions } from "./service";

const admin = roleMiddleware("admin");
const regionId = z.string().min(1).max(64);

export const listTileRegionsFn = createServerFn({ method: "GET" })
  .middleware([admin])
  .handler(() => listAdminTileRegions(getDb(), getEnv().TILES_PATH));

export const enqueueWorldTilesFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .handler(() => {
    enqueueJob(getDb(), WORLD_JOB);
    return true;
  });

export const refreshTileRegionFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(z.object({ regionId }))
  .handler(({ data }) => {
    enqueueJob(getDb(), EXTRACT_JOB, { regionId: data.regionId, force: true });
    return true;
  });

export const deleteTileRegionFn = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(z.object({ regionId }))
  .handler(({ data }) => {
    enqueueJob(getDb(), DELETE_JOB, { regionId: data.regionId });
    return true;
  });
