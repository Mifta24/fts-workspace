import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Empty fallback lets `prisma generate` run without a database (e.g. postinstall).
    url: process.env.DATABASE_URL ?? "",
  },
});
