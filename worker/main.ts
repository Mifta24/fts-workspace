/**
 * Background worker: `pnpm worker`. Runs queued jobs (document indexing today).
 * Environment: DATABASE_URL and STORAGE_DIR (the same directory the app uses).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { INGEST_JOB } from "../src/features/knowledge/schemas/knowledge";
import { ingestDocument } from "../src/features/knowledge/server/ingest";
import { runJobs } from "../src/server/jobs/queue";
import { createLocalStorage } from "../src/server/storage/storage";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const storage = createLocalStorage(process.env.STORAGE_DIR ?? ".data/files");

const handlers = {
  [INGEST_JOB]: (job: Parameters<typeof ingestDocument>[1]) =>
    ingestDocument({ prisma, storage }, job),
};

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ service: "fts-worker", message, ...fields }));

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

log("worker ready");
while (!stopping) {
  try {
    const result = await runJobs(prisma, handlers, { max: 10 });
    if (result.done + result.retried + result.failed > 0) log("jobs processed", result);
  } catch (error) {
    log("worker loop error", { error: String(error) });
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
await prisma.$disconnect();
