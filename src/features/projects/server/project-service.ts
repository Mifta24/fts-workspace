import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  createProjectSchema,
  projectIdSchema,
  updateProjectSchema,
} from "@/features/projects/schemas/project";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export type ProjectView = {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
};

const select = { id: true, name: true, description: true, status: true, createdAt: true } as const;

const notFound = () => new AppError("NOT_FOUND", "Project not found.");

export async function listProjects(
  { prisma }: Deps,
  context: OrganizationContext,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectView[]> {
  requirePermission(context, "project:read");
  return prisma.project.findMany({
    where: {
      organizationId: context.organization.id,
      ...(options.includeArchived ? {} : { status: "ACTIVE" }),
    },
    select,
    orderBy: { name: "asc" },
  });
}

export async function createProject(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<ProjectView> {
  requirePermission(context, "project:create");
  const parsed = createProjectSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Project details are invalid.");

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        organizationId: context.organization.id,
        createdById: context.userId,
        name: parsed.data.name,
        description: parsed.data.description,
      },
      select,
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "project.created",
      resourceType: "project",
      resourceId: project.id,
      correlationId,
    });
    return project;
  });
}

export async function updateProject(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  projectId: string,
  rawInput: unknown,
): Promise<ProjectView> {
  requirePermission(context, "project:update");
  const id = projectIdSchema.safeParse(projectId);
  if (!id.success) throw notFound();
  const parsed = updateProjectSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Project details are invalid.");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.project.findFirst({
      where: { id: id.data, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!existing) throw notFound();
    const project = await tx.project.update({
      where: { id: existing.id },
      data: parsed.data,
      select,
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "project.updated",
      resourceType: "project",
      resourceId: project.id,
      metadata: { fields: Object.keys(parsed.data) },
      correlationId,
    });
    return project;
  });
}

export async function archiveProject(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  projectId: string,
): Promise<void> {
  requirePermission(context, "project:archive");
  const id = projectIdSchema.safeParse(projectId);
  if (!id.success) throw notFound();

  await prisma.$transaction(async (tx) => {
    const result = await tx.project.updateMany({
      where: { id: id.data, organizationId: context.organization.id, status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });
    if (result.count === 0) throw notFound();
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "project.archived",
      resourceType: "project",
      resourceId: id.data,
      correlationId,
    });
  });
}
