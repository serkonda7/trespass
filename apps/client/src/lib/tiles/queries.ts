import { queryOptions } from "@tanstack/solid-query";
import { listTileRegionsFn } from "@trespass/server/tiles/functions";

export const adminTilesQuery = () =>
  queryOptions({ queryKey: ["admin", "tiles"], queryFn: () => listTileRegionsFn() });
