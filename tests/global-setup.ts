import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";
import { startLocalPostgres, type LocalPostgres } from "../scripts/local-postgres";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const TEST_DATABASE = "fts_workspace_test";

/**
 * Uses TEST_DATABASE_URL when provided (CI service container); otherwise starts
 * a throwaway embedded PostgreSQL. Applies migrations before any test runs.
 */
export default async function setup(project: TestProject) {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let local: LocalPostgres | undefined;

  if (!databaseUrl) {
    local = await startLocalPostgres({
      dataDir: ".data/postgres-test",
      port: 54329,
      persistent: false,
      password: "fts_test_password",
    });
    await local.ensureDatabase(TEST_DATABASE);
    databaseUrl = local.urlFor(TEST_DATABASE);
  }
  if (!new URL(databaseUrl).pathname.includes("_test")) {
    throw new Error("TEST_DATABASE_URL must point to a database whose name contains '_test'.");
  }

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  project.provide("databaseUrl", databaseUrl);
  return async () => {
    await local?.stop();
  };
}
