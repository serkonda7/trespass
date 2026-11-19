// Query options for the caller's own equipment and packing templates.
import { queryOptions } from "@tanstack/solid-query";
import { getEquipmentFn } from "@trespass/server/equipment/functions";

export const equipmentQuery = () =>
  queryOptions({
    queryKey: ["equipment"],
    queryFn: () => getEquipmentFn(),
  });
