import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  commentSchema,
  createTaskSchema,
  taskFilterSchema,
  taskIdSchema,
  updateTaskSchema,
  type TaskFilter,
} from "@/features/tasks/schemas/task";
import { awardTaskCompletion } from "@/features/gamification/server/award";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember, assertActiveProject, lockTree } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; correlationId?: string };
type Tx = Prisma.TransactionClient;

/** Maximum subtask nesting; also bounds the ancestor walk used for cycle checks. */
export const MAX_TASK_DEPTH = 5;
const LIST_LIMIT = 200;

const select = {
  id: true,
  projectId: true,
  goalId: true,
  parentTaskId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  assigneeId: true,
  createdById: true,
  startsAt: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.TaskSelect;

export type TaskView = Prisma.TaskGetPayload<{ select: typeof select }>;

export type CommentView = { id: string; authorId: string; body: string; createdAt: Date };

const taskNotFound = () => new AppError("NOT_FOUND", "Task not found.");

export async function listTasks(
  { prisma }: Deps,
  context: OrganizationContext,
  rawFilter: unknown = {},
  now: Date = new Date(),
): Promise<TaskView[]> {
  requirePermission(context, "task:read");
  const parsed = taskFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Task filter is invalid.");
  const filter: TaskFilter = parsed.data;

  return prisma.task.findMany({
    where: {
      organizationId: context.organization.id,
      status: filter.overdue ? { notIn: ["COMPLETED", "CANCELLED"] } : (filter.status ?? undefined),
      assigneeId: filter.assigneeId,
      goalId: filter.goalId,
      projectId: filter.projectId,
      parentTaskId: filter.parentTaskId,
      ...(filter.overdue ? { dueAt: { lt: now } } : {}),
    },
    select,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
    take: LIST_LIMIT,
  });
}

export async function getTask(
  { prisma }: Deps,
  context: OrganizationContext,
  taskId: string,
): Promise<TaskView> {
  requirePermission(context, "task:read");
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) throw taskNotFound();
  const task = await prisma.task.findFirst({
    where: { id: id.data, organizationId: context.organization.id },
    select,
  });
  if (!task) throw taskNotFound();
  return task;
}

export async function createTask(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<TaskView> {
  requirePermission(context, "task:create");
  const parsed = createTaskSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Task details are invalid.");
  const input = parsed.data;
  const organizationId = context.organization.id;

  const { task: created, notified } = await prisma.$transaction(async (tx) => {
    await assertReferences(tx, organizationId, input);
    if (input.parentTaskId) {
      await lockTree(tx, "task", organizationId);
      await assertValidParent(tx, organizationId, input.parentTaskId, null);
    }
    const task = await tx.task.create({
      data: {
        organizationId,
        createdById: context.userId,
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        goalId: input.goalId,
        parentTaskId: input.parentTaskId,
        assigneeId: input.assigneeId,
        status: input.status,
        priority: input.priority,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
        completedAt: input.status === "COMPLETED" ? new Date() : undefined,
      },
      select,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "task.created",
      resourceType: "task",
      resourceId: task.id,
      metadata: task.assigneeId ? { assigneeId: task.assigneeId } : undefined,
      correlationId,
    });
    const notified = task.assigneeId
      ? await createNotifications(tx, [
          {
            organizationId,
            userId: task.assigneeId,
            type: "TASK_ASSIGNED",
            actorId: context.userId,
            resourceType: "task",
            resourceId: task.id,
          },
        ])
      : [];
    return { task, notified };
  });
  await publishNotifications(notified);
  return created;
}

export async function updateTask(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  taskId: string,
  rawInput: unknown,
): Promise<TaskView> {
  requirePermission(context, "task:update");
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) throw taskNotFound();
  const parsed = updateTaskSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Task details are invalid.");
  const input = parsed.data;
  const organizationId = context.organization.id;

  const { task: updated, notified } = await prisma.$transaction(async (tx) => {
    await lockTree(tx, "task", organizationId);
    const existing = await tx.task.findFirst({
      where: { id: id.data, organizationId },
      select,
    });
    if (!existing) throw taskNotFound();

    // Re-validate only references that actually change.
    await assertReferences(tx, organizationId, {
      projectId:
        input.projectId && input.projectId !== existing.projectId ? input.projectId : undefined,
      goalId: input.goalId && input.goalId !== existing.goalId ? input.goalId : undefined,
      assigneeId:
        input.assigneeId && input.assigneeId !== existing.assigneeId ? input.assigneeId : undefined,
    });
    if (input.parentTaskId) {
      await assertValidParent(tx, organizationId, input.parentTaskId, existing.id);
    }
    const startsAt = input.startsAt === undefined ? existing.startsAt : input.startsAt;
    const dueAt = input.dueAt === undefined ? existing.dueAt : input.dueAt;
    if (startsAt && dueAt && startsAt > dueAt) {
      throw new AppError("INVALID_INPUT", "Due date is before the start date.");
    }

    const status = input.status ?? existing.status;
    const becameCompleted = status === "COMPLETED" && existing.status !== "COMPLETED";
    const task = await tx.task.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        goalId: input.goalId,
        parentTaskId: input.parentTaskId,
        assigneeId: input.assigneeId,
        status: input.status,
        priority: input.priority,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
        // Completion time is set once, on the transition, and cleared when reopened.
        completedAt: becameCompleted ? new Date() : status === "COMPLETED" ? undefined : null,
      },
      select,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: becameCompleted ? "task.completed" : "task.updated",
      resourceType: "task",
      resourceId: task.id,
      metadata: {
        fields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
      },
      correlationId,
    });
    if (becameCompleted) {
      await awardTaskCompletion(tx, {
        organizationId,
        actorId: context.userId,
        task: { ...task, createdAt: existing.createdAt },
        now: task.completedAt ?? new Date(),
      });
    }
    const notified =
      task.assigneeId && task.assigneeId !== existing.assigneeId
        ? await createNotifications(tx, [
            {
              organizationId,
              userId: task.assigneeId,
              type: "TASK_ASSIGNED",
              actorId: context.userId,
              resourceType: "task",
              resourceId: task.id,
            },
          ])
        : [];
    return { task, notified };
  });
  await publishNotifications(notified);
  return updated;
}

export async function addComment(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  taskId: string,
  rawInput: unknown,
): Promise<CommentView> {
  requirePermission(context, "task:comment");
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) throw taskNotFound();
  const parsed = commentSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Comment is invalid.");

  const { comment: posted, notified } = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
      select: { id: true, assigneeId: true, createdById: true },
    });
    if (!task) throw taskNotFound();
    const comment = await tx.taskComment.create({
      data: {
        organizationId: context.organization.id,
        taskId: task.id,
        authorId: context.userId,
        body: parsed.data.body,
      },
      select: { id: true, authorId: true, body: true, createdAt: true },
    });
    // The comment body is content; the audit trail records only that it happened.
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "task.commented",
      resourceType: "task",
      resourceId: task.id,
      metadata: { commentId: comment.id },
      correlationId,
    });
    // The assignee and the creator hear about new comments; createNotifications skips the author.
    const recipients = [...new Set([task.assigneeId, task.createdById])].flatMap((userId) =>
      userId ? [userId] : [],
    );
    const notified = await createNotifications(
      tx,
      recipients.map((userId) => ({
        organizationId: context.organization.id,
        userId,
        type: "TASK_COMMENTED" as const,
        actorId: context.userId,
        resourceType: "task",
        resourceId: task.id,
      })),
    );
    return { comment, notified };
  });
  await publishNotifications(notified);
  return posted;
}

export async function listComments(
  { prisma }: Deps,
  context: OrganizationContext,
  taskId: string,
): Promise<CommentView[]> {
  requirePermission(context, "task:read");
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) throw taskNotFound();
  return prisma.taskComment.findMany({
    where: { organizationId: context.organization.id, taskId: id.data },
    select: { id: true, authorId: true, body: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
}

async function assertReferences(
  tx: Tx,
  organizationId: string,
  refs: { projectId?: string; goalId?: string; assigneeId?: string },
) {
  if (refs.assigneeId) {
    await assertActiveMember(
      tx,
      organizationId,
      refs.assigneeId,
      "The assignee must be an active member.",
    );
  }
  if (refs.projectId) await assertActiveProject(tx, organizationId, refs.projectId);
  if (refs.goalId) {
    const goal = await tx.goal.findFirst({
      where: { id: refs.goalId, organizationId, status: { not: "ARCHIVED" } },
      select: { id: true },
    });
    if (!goal) throw new AppError("UNPROCESSABLE", "The goal is not available.");
  }
}

/** Parent must be in the same organization, not the task itself or a descendant, within depth. */
async function assertValidParent(
  tx: Tx,
  organizationId: string,
  parentId: string,
  taskId: string | null,
) {
  let currentId: string | null = parentId;
  let depth = 1;
  while (currentId) {
    if (currentId === taskId) {
      throw new AppError("UNPROCESSABLE", "A task cannot be nested under itself or its subtasks.");
    }
    const node: { parentTaskId: string | null } | null = await tx.task.findFirst({
      where: { id: currentId, organizationId },
      select: { parentTaskId: true },
    });
    if (!node) throw new AppError("UNPROCESSABLE", "The parent task is not available.");
    if (++depth > MAX_TASK_DEPTH) {
      throw new AppError("UNPROCESSABLE", "Subtasks can be nested at most 5 levels deep.");
    }
    currentId = node.parentTaskId;
  }
}
