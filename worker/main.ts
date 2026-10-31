/**
 * Background worker: `pnpm worker`. Runs queued jobs (document indexing, meeting reminders, automations) and
 * the five-minute sweep for tasks that are due within a day.
 * Environment: DATABASE_URL and STORAGE_DIR (the same directory the app uses).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { AUTOMATION_JOB } from "../src/features/automations/schemas/automations";
import { runAutomation } from "../src/features/automations/server/automation-runner";
import { sendDueSoonReminders } from "../src/features/tasks/server/deadline-reminders";
import { DEADLINE_SWEEP_INTERVAL_MS } from "../src/features/tasks/schemas/deadline-reminders";
import { INGEST_JOB } from "../src/features/knowledge/schemas/knowledge";
import { ingestDocument } from "../src/features/knowledge/server/ingest";
import { REMINDER_JOB } from "../src/features/scheduling/schemas/scheduling";
import { sendAppointmentReminder } from "../src/features/scheduling/server/reminders";
import { runJobs } from "../src/server/jobs/queue";
import { createLocalStorage } from "../src/server/storage/storage";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const storage = createLocalStorage(process.env.STORAGE_DIR ?? ".data/files");

const handlers = {
  [INGEST_JOB]: (job: Parameters<typeof ingestDocument>[1]) =>
    ingestDocument({ prisma, storage }, job),
  [REMINDER_JOB]: (job: Parameters<typeof sendAppointmentReminder>[1]) =>
    sendAppointmentReminder({ prisma }, job),
  [AUTOMATION_JOB]: (job: Parameters<typeof runAutomation>[1]) => runAutomation({ prisma }, job),
};

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ service: "fts-worker", message, ...fields }));

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

log("worker ready");
let lastSweep = 0;
while (!stopping) {
  try {
    if (Date.now() - lastSweep >= DEADLINE_SWEEP_INTERVAL_MS) {
      lastSweep = Date.now();
      const { reminded } = await sendDueSoonReminders({ prisma });
      if (reminded > 0) log("deadline reminders sent", { reminded });
    }
    const result = await runJobs(prisma, handlers, { max: 10 });
    if (result.done + result.retried + result.failed > 0) log("jobs processed", result);
  } catch (error) {
    log("worker loop error", { error: String(error) });
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
await prisma.$disconnect();
