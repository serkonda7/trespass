// Tile job kinds (DESIGN §7.2). Handlers live in ./jobs, which is worker-only;
// web-side modules import the kind constants from here instead.
export const ENSURE_JOB = "tiles.ensure";
export const EXTRACT_JOB = "tiles.extract";
export const WORLD_JOB = "tiles.world";
export const PRUNE_JOB = "tiles.prune";
export const REFRESH_JOB = "tiles.refresh";
export const DELETE_JOB = "tiles.delete";
