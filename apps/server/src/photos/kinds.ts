// Photo job kinds. Handlers live in ./jobs, which is worker-only; web-side
// modules import the kind constants from here instead.
export const PROCESS_JOB = "photos.process";
export const GC_JOB = "photos.gc";
export const SWEEP_JOB = "photos.sweep";
