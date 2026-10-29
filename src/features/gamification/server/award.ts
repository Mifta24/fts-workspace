import "server-only";
import type { Prisma, TaskPriority } from "@/generated/prisma/client";
import {
  DAILY_AWARD_CAP,
  SELF_CREATED_COOLDOWN_MS,
  TASK_POINTS,
} from "@/features/gamification/schemas/gamification";

export type CompletedTask = {
  id: string;
  priority: TaskPriority;
  assigneeId: string | null;
  createdById: string;
  createdAt: Date;
};

export const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Appends a TASK_COMPLETED award inside the caller's transaction (the same one that records
 * the completion and its audit event), when every anti-farming rule passes:
 *  - only the assignee earns points, for finishing their own assigned task;
 *  - a task you created yourself pays nothing if you finish it within 10 minutes;
 *  - at most 10 awards per user per UTC day;
 *  - one award per task and user, ever (the unique key also covers reopen/complete loops
 *    and concurrent retries).
 */
export async function awardTaskCompletion(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; actorId: string; task: CompletedTask; now: Date },
): Promise<{ awarded: boolean; points: number }> {
  const { organizationId, actorId, task, now } = params;
  if (task.assigneeId !== actorId) return { awarded: false, points: 0 };
  if (
    task.createdById === actorId &&
    now.getTime() - task.createdAt.getTime() < SELF_CREATED_COOLDOWN_MS
  ) {
    return { awarded: false, points: 0 };
  }
  const today = await tx.pointEvent.count({
    where: { organizationId, userId: actorId, createdAt: { gte: startOfUtcDay(now) } },
  });
  if (today >= DAILY_AWARD_CAP) return { awarded: false, points: 0 };

  const points = TASK_POINTS[task.priority];
  const created = await tx.pointEvent.createMany({
    data: [
      {
        organizationId,
        userId: actorId,
        type: "TASK_COMPLETED",
        points,
        sourceType: "task",
        sourceId: task.id,
        createdAt: now,
      },
    ],
    skipDuplicates: true,
  });
  return created.count === 1 ? { awarded: true, points } : { awarded: false, points: 0 };
}
