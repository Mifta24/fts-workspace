import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { dashboardFilterSchema } from "@/features/dashboard/schemas/dashboard";

type Deps = { prisma: PrismaClient };

export type DashboardData = {
  activeGoals: number;
  /** Open tasks assigned to the caller (not affected by the assignee filter). */
  myOpenTasks: number;
  completedTasks: number;
  overdueTasks: number;
  /** Completed / non-cancelled tasks matching the filters; null when there are none. */
  progress: number | null;
  totalTasks: number;
};

const DAY_MS = 86_400_000;
const DONE = ["COMPLETED", "CANCELLED"] as const;

/**
 * Aggregates for the overview dashboard. Every query is scoped to the caller's
 * organization; a foreign project or assignee id simply matches nothing.
 */
export async function getDashboard(
  { prisma }: Deps,
  context: OrganizationContext,
  rawFilter: unknown = {},
  now: Date = new Date(),
): Promise<DashboardData> {
  requirePermission(context, "dashboard:read");
  requirePermission(context, "goal:read");
  requirePermission(context, "task:read");
  const parsed = dashboardFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Dashboard filter is invalid.");
  const { projectId, assigneeId, range } = parsed.data;

  const organizationId = context.organization.id;
  const since = range === "all" ? undefined : new Date(now.getTime() - Number(range) * DAY_MS);
  const scope = { organizationId, projectId, assigneeId };

  const [activeGoals, myOpenTasks, completedTasks, overdueTasks, totals] = await Promise.all([
    prisma.goal.count({ where: { organizationId, projectId, status: "ACTIVE" } }),
    prisma.task.count({
      where: {
        organizationId,
        projectId,
        assigneeId: context.userId,
        status: { notIn: [...DONE] },
      },
    }),
    prisma.task.count({
      where: { ...scope, status: "COMPLETED", ...(since ? { completedAt: { gte: since } } : {}) },
    }),
    prisma.task.count({
      where: { ...scope, status: { notIn: [...DONE] }, dueAt: { lt: now } },
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: { ...scope, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
  ]);

  const totalTasks = totals.reduce((sum, group) => sum + group._count._all, 0);
  const completedTotal = totals.find((group) => group.status === "COMPLETED")?._count._all ?? 0;
  return {
    activeGoals,
    myOpenTasks,
    completedTasks,
    overdueTasks,
    totalTasks,
    progress: totalTasks === 0 ? null : Math.round((completedTotal / totalTasks) * 100),
  };
}
