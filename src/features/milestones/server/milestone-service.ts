import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { goalIdSchema } from "@/features/goals/schemas/goal";
import {
  createMilestoneSchema,
  MAX_MILESTONES_PER_GOAL,
  milestoneIdSchema,
} from "@/features/milestones/schemas/milestone";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export type MilestoneView = {
  id: string;
  goalId: string;
  title: string;
  dueAt: Date | null;
  completedAt: Date | null;
};

const select = { id: true, goalId: true, title: true, dueAt: true, completedAt: true } as const;

const notFound = () => new AppError("NOT_FOUND", "Milestone not found.");
const goalNotFound = () => new AppError("NOT_FOUND", "Goal not found.");

export async function listMilestones(
  { prisma }: Deps,
  context: OrganizationContext,
  goalId: string,
): Promise<MilestoneView[]> {
  requirePermission(context, "goal:read");
  const id = goalIdSchema.safeParse(goalId);
  if (!id.success) throw goalNotFound();
  return prisma.milestone.findMany({
    where: { organizationId: context.organization.id, goalId: id.data },
    select,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** Milestones are part of a goal, so managing them needs `goal:update`. */
export async function addMilestone(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  goalId: string,
  rawInput: unknown,
): Promise<MilestoneView> {
  requirePermission(context, "goal:update");
  const id = goalIdSchema.safeParse(goalId);
  if (!id.success) throw goalNotFound();
  const parsed = createMilestoneSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Milestone details are invalid.");
  const organizationId = context.organization.id;

  return prisma.$transaction(async (tx) => {
    const goal = await tx.goal.findFirst({
      where: { id: id.data, organizationId },
      select: { id: true, status: true },
    });
    if (!goal) throw goalNotFound();
    if (goal.status === "ARCHIVED") {
      throw new AppError("UNPROCESSABLE", "Archived goals cannot be edited.");
    }
    const count = await tx.milestone.count({ where: { organizationId, goalId: goal.id } });
    if (count >= MAX_MILESTONES_PER_GOAL) {
      throw new AppError("UNPROCESSABLE", "A goal can have at most 50 milestones.");
    }
    const milestone = await tx.milestone.create({
      data: {
        organizationId,
        goalId: goal.id,
        title: parsed.data.title,
        dueAt: parsed.data.dueAt,
        createdById: context.userId,
      },
      select,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "milestone.created",
      resourceType: "milestone",
      resourceId: milestone.id,
      metadata: { goalId: goal.id },
      correlationId,
    });
    return milestone;
  });
}

export async function setMilestoneCompleted(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  milestoneId: string,
  completed: boolean,
): Promise<MilestoneView> {
  requirePermission(context, "goal:update");
  const id = milestoneIdSchema.safeParse(milestoneId);
  if (!id.success) throw notFound();
  const organizationId = context.organization.id;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.milestone.findFirst({
      where: { id: id.data, organizationId },
      select: { ...select, goal: { select: { status: true } } },
    });
    if (!existing) throw notFound();
    if (existing.goal.status === "ARCHIVED") {
      throw new AppError("UNPROCESSABLE", "Archived goals cannot be edited.");
    }
    // Idempotent: repeating the same transition changes nothing and logs nothing.
    if (completed === (existing.completedAt !== null)) {
      return {
        id: existing.id,
        goalId: existing.goalId,
        title: existing.title,
        dueAt: existing.dueAt,
        completedAt: existing.completedAt,
      };
    }
    const milestone = await tx.milestone.update({
      where: { id: existing.id },
      data: { completedAt: completed ? new Date() : null },
      select,
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: completed ? "milestone.completed" : "milestone.reopened",
      resourceType: "milestone",
      resourceId: milestone.id,
      metadata: { goalId: milestone.goalId },
      correlationId,
    });
    return milestone;
  });
}

export async function deleteMilestone(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  milestoneId: string,
): Promise<void> {
  requirePermission(context, "goal:update");
  const id = milestoneIdSchema.safeParse(milestoneId);
  if (!id.success) throw notFound();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.milestone.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
      select: { id: true, goalId: true, goal: { select: { status: true } } },
    });
    if (!existing) throw notFound();
    if (existing.goal.status === "ARCHIVED") {
      throw new AppError("UNPROCESSABLE", "Archived goals cannot be edited.");
    }
    await tx.milestone.delete({ where: { id: existing.id } });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "milestone.deleted",
      resourceType: "milestone",
      resourceId: existing.id,
      metadata: { goalId: existing.goalId },
      correlationId,
    });
  });
}
