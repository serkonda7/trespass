import { defineConfig } from "drizzle-kit";

// Only used by `bun run db:generate`; the app applies apps/server/drizzle at startup.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
