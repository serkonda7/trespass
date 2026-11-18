import { dirname, join } from "node:path";
import { z } from "zod";

// Server configuration (DESIGN §8.2). Read once, validated with Zod.
// Dev gets sensible defaults; production refuses to start without a real secret.

const DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789";

/** Compose passes unset optionals as "" (e.g. `${SMTP_URL:-}`); treat that as missing. */
const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ORIGIN: z
    .url()
    .default("http://localhost:3000")
    .transform((v) => new URL(v).origin),
  DATABASE_PATH: z.string().min(1).default("./data/db/app.sqlite"),
  UPLOAD_DIR: z.string().min(1).default("./data/uploads"),
  /** MBTiles file for /tiles; defaults to <dir of DATABASE_PATH>/../tiles/tiles.sqlite. */
  TILES_PATH: optional,
  /** Automatic tile regions; "off" disables enqueueing and extraction (e2e sets this). */
  TILES: optional.pipe(z.enum(["on", "off"]).default("on")),
  /** go-pmtiles CLI in the worker image. */
  PMTILES_BIN: optional,
  /** Direct URL of one Protomaps build, instead of probing the daily builds. */
  TILES_BUILD_URL: optional,
  BETTER_AUTH_SECRET: optional,
  SMTP_URL: optional,
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  /** Reverse geocoding (Nominatim); "off" disables the job entirely (e2e sets this). */
  GEOCODE: optional.pipe(z.enum(["on", "off"]).default("on")),
  /** Optional integrations used by later stages (research, notifications, healthchecks.io). */
  ANTHROPIC_API_KEY: optional,
  NTFY_URL: optional,
  HEALTHCHECK_URL: optional,
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = Omit<z.output<typeof schema>, "BETTER_AUTH_SECRET" | "TILES_PATH"> & {
  BETTER_AUTH_SECRET: string;
  /** Always resolved to a concrete path; the MBTiles file itself is optional. */
  TILES_PATH: string;
  isProduction: boolean;
};

/** Pure parser, exported for tests. Throws on invalid configuration. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";
  let secret = e.BETTER_AUTH_SECRET;
  if (!secret) {
    if (isProduction) {
      throw new Error("BETTER_AUTH_SECRET must be set in production.");
    }
    secret = DEV_SECRET;
  }
  if (isProduction && secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  }
  const tilesPath = e.TILES_PATH ?? join(dirname(e.DATABASE_PATH), "..", "tiles", "tiles.sqlite");
  return { ...e, TILES_PATH: tilesPath, BETTER_AUTH_SECRET: secret, isProduction };
}

let cached: Env | undefined;

/** The validated environment of this process (cached). */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
