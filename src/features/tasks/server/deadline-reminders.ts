import type { PrismaClient } from "@/generated/prisma/client";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import {
  DEADLINE_SWEEP_BATCH,
  DUE_SOON_WINDOW_MS,
} from "@/features/tasks/schemas/deadline-reminders";

type Candidate = { id: string; organizationId: string; assigneeId: string; dueAt: Date };

/**
 * Worker-side sweep: tells the assignee of each open task that it falls due within the next day.
 * A `task_due_reminders` row is written in the same transaction as the notification, so a task is
 * announced once per person and due date however often the sweep runs. Moving the due date or
 * reassigning the task earns a new reminder. Done, cancelled and overdue tasks and suspended
 * workspaces are left alone. Each task is re-read inside its own organization before anything is
 * written, so a change since the candidate list was built sends nothing.
 */
export async function sendDueSoonReminders(
  deps: { prisma: PrismaClient },
  now: Date = new Date(),
): Promise<{ reminded: number }> {
  const { prisma } = deps;
  const until = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT t."id", t."organizationId", t."assigneeId", t."dueAt"
    FROM "tasks" t
    JOIN "organizations" o ON o."id" = t."organizationId"
    WHERE t."assigneeId" IS NOT NULL
      AND t."status" NOT IN ('COMPLETED', 'CANCELLED')
      AND t."dueAt" > ${now} AND t."dueAt" <= ${until}
      AND o."suspendedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "task_due_reminders" r
        WHERE r."taskId" = t."id" AND r."userId" = t."assigneeId" AND r."dueAt" = t."dueAt"
      )
    ORDER BY t."dueAt", t."id"
    LIMIT ${DEADLINE_SWEEP_BATCH}`;

  let reminded = 0;
  for (const candidate of candidates) {
    const notified = await prisma.$transaction(async (tx) => {
      const current = await tx.task.findFirst({
        where: {
          id: candidate.id,
          organizationId: candidate.organizationId,
          assigneeId: candidate.assigneeId,
          dueAt: candidate.dueAt,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        select: { id: true },
      });
      if (!current) return [];
      const claimed = await tx.taskDueReminder.createMany({
        data: [
          {
            organizationId: candidate.organizationId,
            taskId: candidate.id,
            userId: candidate.assigneeId,
            dueAt: candidate.dueAt,
          },
        ],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return []; // another sweep got there first
      return createNotifications(tx, [
        {
          organizationId: candidate.organizationId,
          userId: candidate.assigneeId,
          type: "TASK_DUE_SOON",
          actorId: null,
          resourceType: "task",
          resourceId: candidate.id,
        },
      ]);
    });
    await publishNotifications(notified);
    reminded += notified.length;
  }
  return { reminded };
}
