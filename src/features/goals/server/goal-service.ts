import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  createGoalSchema,
  goalIdSchema,
  updateGoalSchema,
  type CreateGoalInput,
} from "@/features/goals/schemas/goal";
import { computeGoalProgress } from "@/features/goals/server/progress";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember, assertActiveProject, lockTree } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; correlationId?: string };

/** Hard cap on nesting; also bounds the ancestor walk used for cycle checks. */
export const MAX_GOAL_DEPTH = 10;

export type GoalView = {
  id: string;
  projectId: string | null;
  parentGoalId: string | null;
  title: string;
  description: string | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  progressMode: "TASK_BASED" | "MILESTONE_BASED" | "NUMERIC_KPI" | "MANUAL";
  progress: number | null;
  manualProgress: number | null;
  targetValue: number | null;
  currentValue: number | null;
  ownerId: string;
  dueAt: Date | null;
};

const select = {
  id: true,
  projectId: true,
  parentGoalId: true,
  title: true,
  description: true,
  status: true,
  progressMode: true,
  manualProgress: true,
  targetValue: true,
  currentValue: true,
  ownerId: true,
  dueAt: true,
} satisfies Prisma.GoalSelect;

type GoalRow = Prisma.GoalGetPayload<{ select: typeof select }>;

type TaskStats = ReadonlyMap<string, { total: number; completed: number }>;

function toView(row: GoalRow, stats?: TaskStats): GoalView {
  const targetValue = row.targetValue === null ? null : Number(row.targetValue);
  const currentValue = row.currentValue === null ? null : Number(row.currentValue);
  return {
    ...row,
    targetValue,
    currentValue,
    progress: computeGoalProgress({
      progressMode: row.progressMode,
      manualProgress: row.manualProgress,
      targetValue,
      currentValue,
      tasks: stats?.get(row.id),
    }),
  };
}

/** Non-cancelled task counts per goal, for task-based progress. */
async function loadTaskStats(
  client: Pick<PrismaClient, "task">,
  organizationId: string,
  goalIds: string[],
): Promise<TaskStats> {
  if (goalIds.length === 0) return new Map();
  const groups = await client.task.groupBy({
    by: ["goalId", "status"],
    where: { organizationId, goalId: { in: goalIds }, status: { not: "CANCELLED" } },
    _count: { _all: true },
  });
  const stats = new Map<string, { total: number; completed: number }>();
  for (const group of groups) {
    if (!group.goalId) continue;
    const entry = stats.get(group.goalId) ?? { total: 0, completed: 0 };
    entry.total += group._count._all;
    if (group.status === "COMPLETED") entry.completed += group._count._all;
    stats.set(group.goalId, entry);
  }
  return stats;
}

const goalNotFound = () => new AppError("NOT_FOUND", "Goal not found.");

export async function listGoals(
  { prisma }: Deps,
  context: OrganizationContext,
  options: { projectId?: string; includeArchived?: boolean } = {},
): Promise<GoalView[]> {
  requirePermission(context, "goal:read");
  const rows = await prisma.goal.findMany({
    where: {
      organizationId: context.organization.id,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.includeArchived ? {} : { status: { not: "ARCHIVED" } }),
    },
    select,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const stats = await loadTaskStats(
    prisma,
    context.organization.id,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toView(row, stats));
}

export async function getGoal(
  { prisma }: Deps,
  context: OrganizationContext,
  goalId: string,
): Promise<GoalView> {
  requirePermission(context, "goal:read");
  const id = goalIdSchema.safeParse(goalId);
  if (!id.success) throw goalNotFound();
  const row = await prisma.goal.findFirst({
    where: { id: id.data, organizationId: context.organization.id },
    select,
  });
  if (!row) throw goalNotFound();
  return toView(row, await loadTaskStats(prisma, context.organization.id, [row.id]));
}

export async function createGoal(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<GoalView> {
  requirePermission(context, "goal:create");
  const parsed = createGoalSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Goal details are invalid.");
  const input: CreateGoalInput = parsed.data;

  return prisma.$transaction(async (tx) => {
    const ownerId = input.ownerId ?? context.userId;
    await assertActiveMember(
      tx,
      context.organization.id,
      ownerId,
      "The owner must be an active member.",
    );
    if (input.projectId) await assertActiveProject(tx, context.organization.id, input.projectId);
    if (input.parentGoalId) {
      await lockTree(tx, "goal", context.organization.id);
      await assertValidParent(tx, context.organization.id, input.parentGoalId, null);
    }

    const row = await tx.goal.create({
      data: {
        organizationId: context.organization.id,
        createdById: context.userId,
        ownerId,
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        parentGoalId: input.parentGoalId,
        progressMode: input.progressMode,
        manualProgress: input.progressMode === "MANUAL" ? input.manualProgress : undefined,
        targetValue: input.progressMode === "NUMERIC_KPI" ? input.targetValue : undefined,
        currentValue: input.progressMode === "NUMERIC_KPI" ? input.currentValue : undefined,
        dueAt: input.dueAt,
      },
      select,
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "goal.created",
      resourceType: "goal",
      resourceId: row.id,
      correlationId,
    });
    return toView(row);
  });
}

export async function updateGoal(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  goalId: string,
  rawInput: unknown,
): Promise<GoalView> {
  requirePermission(context, "goal:update");
  const id = goalIdSchema.safeParse(goalId);
  if (!id.success) throw goalNotFound();
  const parsed = updateGoalSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Goal details are invalid.");
  const input = parsed.data;

  return prisma.$transaction(async (tx) => {
    // Serialize tree edits per organization so concurrent moves cannot form a cycle.
    await lockTree(tx, "goal", context.organization.id);
    const existing = await tx.goal.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
      select,
    });
    if (!existing) throw goalNotFound();
    if (existing.status === "ARCHIVED") {
      throw new AppError("UNPROCESSABLE", "Archived goals cannot be edited.");
    }

    const mode = input.progressMode ?? existing.progressMode;
    const target =
      input.targetValue ??
      (existing.targetValue === null ? undefined : Number(existing.targetValue));
    if (mode === "NUMERIC_KPI" && target === undefined) {
      throw new AppError("INVALID_INPUT", "A KPI goal needs a target.");
    }

    if (input.ownerId)
      await assertActiveMember(
        tx,
        context.organization.id,
        input.ownerId,
        "The owner must be an active member.",
      );
    if (input.projectId) await assertActiveProject(tx, context.organization.id, input.projectId);
    if (input.parentGoalId) {
      await assertValidParent(tx, context.organization.id, input.parentGoalId, existing.id);
    }

    const row = await tx.goal.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        parentGoalId: input.parentGoalId,
        ownerId: input.ownerId,
        status: input.status,
        progressMode: input.progressMode,
        manualProgress: input.manualProgress,
        targetValue: input.targetValue,
        currentValue: input.currentValue,
        dueAt: input.dueAt,
      },
      select,
    });
    const stats = await loadTaskStats(tx, context.organization.id, [row.id]);
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "goal.updated",
      resourceType: "goal",
      resourceId: row.id,
      metadata: {
        fields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
      },
      correlationId,
    });
    return toView(row, stats);
  });
}

/** Archives a goal. Goals that still have active subgoals must be handled first. */
export async function archiveGoal(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  goalId: string,
): Promise<void> {
  requirePermission(context, "goal:archive");
  const id = goalIdSchema.safeParse(goalId);
  if (!id.success) throw goalNotFound();

  await prisma.$transaction(async (tx) => {
    await lockTree(tx, "goal", context.organization.id);
    const activeChildren = await tx.goal.count({
      where: {
        organizationId: context.organization.id,
        parentGoalId: id.data,
        status: { not: "ARCHIVED" },
      },
    });
    if (activeChildren > 0) {
      throw new AppError("CONFLICT", "Archive or move the subgoals first.");
    }
    const result = await tx.goal.updateMany({
      where: { id: id.data, organizationId: context.organization.id, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });
    if (result.count === 0) throw goalNotFound();
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "goal.archived",
      resourceType: "goal",
      resourceId: id.data,
      correlationId,
    });
  });
}

type Tx = Prisma.TransactionClient;

/**
 * The parent must exist in the same organization, must not be archived, must not
 * be the goal itself or one of its descendants (cycle), and must keep the tree
 * within MAX_GOAL_DEPTH. Walks ancestors upward, which also bounds the loop.
 */
async function assertValidParent(
  tx: Tx,
  organizationId: string,
  parentId: string,
  goalId: string | null,
) {
  const unavailable = () => new AppError("UNPROCESSABLE", "The parent goal is not available.");
  let currentId: string | null = parentId;
  let depth = 1;
  while (currentId) {
    if (currentId === goalId) {
      throw new AppError("UNPROCESSABLE", "A goal cannot be nested under itself or its subgoals.");
    }
    const node: { parentGoalId: string | null; status: string } | null = await tx.goal.findFirst({
      where: { id: currentId, organizationId },
      select: { parentGoalId: true, status: true },
    });
    if (!node) throw unavailable();
    if (currentId === parentId && node.status === "ARCHIVED") throw unavailable();
    if (++depth > MAX_GOAL_DEPTH) {
      throw new AppError("UNPROCESSABLE", "Goals can be nested at most 10 levels deep.");
    }
    currentId = node.parentGoalId;
  }
}
