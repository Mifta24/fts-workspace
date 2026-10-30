import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Minimal database-backed job queue. A job is claimed with `FOR UPDATE SKIP LOCKED`, so several
 * workers never run the same job; failures retry with exponential backoff and then stop.
 * This file deliberately has no Next.js imports: the worker process runs it directly.
 */
export type ClaimedJob = {
  id: string;
  organizationId: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

export type JobHandler = (job: ClaimedJob) => Promise<void>;

export const STALE_AFTER_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 30_000;

type Writer = Pick<PrismaClient, "job"> | Pick<Prisma.TransactionClient, "job">;

/** Idempotent per organization when a `dedupeKey` is given. Returns whether a job was created. */
export async function enqueueJob(
  client: Writer,
  job: {
    organizationId: string;
    type: string;
    payload: Prisma.InputJsonObject;
    dedupeKey?: string;
    runAt?: Date;
  },
): Promise<boolean> {
  const result = await client.job.createMany({
    data: [
      {
        organizationId: job.organizationId,
        type: job.type,
        payload: job.payload,
        dedupeKey: job.dedupeKey,
        runAt: job.runAt,
      },
    ],
    skipDuplicates: true,
  });
  return result.count === 1;
}

export async function claimNextJob(prisma: PrismaClient, now: Date): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "jobs"
    SET "status" = 'RUNNING', "lockedAt" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "jobs"
      WHERE "status" = 'QUEUED' AND "runAt" <= ${now}
        -- A suspended workspace's jobs wait (reminders, indexing) and run again once it is restored.
        AND NOT EXISTS (
          SELECT 1 FROM "organizations" o
          WHERE o."id" = "jobs"."organizationId" AND o."suspendedAt" IS NOT NULL
        )
      ORDER BY "runAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "organizationId", "type", "payload", "attempts", "maxAttempts"`;
  return rows[0] ?? null;
}

/** Jobs whose worker died while RUNNING go back to the queue (their attempt still counts). */
export async function requeueStaleJobs(prisma: PrismaClient, now: Date): Promise<number> {
  const result = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
    data: { status: "QUEUED", lockedAt: null },
  });
  return result.count;
}

export async function completeJob(prisma: PrismaClient, id: string, now: Date): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: "DONE", finishedAt: now, lockedAt: null, lastError: null },
  });
}

export async function failJob(
  prisma: PrismaClient,
  job: ClaimedJob,
  error: unknown,
  now: Date,
): Promise<"retry" | "failed"> {
  // Only a short message is kept; handlers must never put document content in errors.
  const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  if (job.attempts >= job.maxAttempts) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: now, lockedAt: null, lastError },
    });
    return "failed";
  }
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      lockedAt: null,
      lastError,
      runAt: new Date(now.getTime() + BACKOFF_BASE_MS * 2 ** (job.attempts - 1)),
    },
  });
  return "retry";
}

/** Runs up to `max` due jobs. Unknown job types fail permanently instead of looping. */
export async function runJobs(
  prisma: PrismaClient,
  handlers: Record<string, JobHandler | undefined>,
  options: { max?: number; now?: () => Date } = {},
): Promise<{ done: number; retried: number; failed: number }> {
  const clock = options.now ?? (() => new Date());
  const counts = { done: 0, retried: 0, failed: 0 };
  await requeueStaleJobs(prisma, clock());
  for (let i = 0; i < (options.max ?? 10); i++) {
    const job = await claimNextJob(prisma, clock());
    if (!job) break;
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job);
      await completeJob(prisma, job.id, clock());
      counts.done += 1;
    } catch (error) {
      const outcome = await failJob(
        prisma,
        handler ? job : { ...job, attempts: job.maxAttempts },
        error,
        clock(),
      );
      counts[outcome === "retry" ? "retried" : "failed"] += 1;
    }
  }
  return counts;
}
