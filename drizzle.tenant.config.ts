import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./drizzle/tenant-schema.ts",
  out: "./drizzle/tenant-migrations",
});
