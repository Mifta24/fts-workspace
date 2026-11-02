import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { dueAfter, requestDeletionSchema } from "@/features/organizations/schemas/deletion";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export type DeletionState = { requestedAt: Date; dueAfter: Date };

/**
 * The owner asks for the whole workspace to be deleted. This only records the request (the data
 * stays, the workspace keeps working, the owner can cancel); an operator removes the data once the
 * waiting period has passed. Asking twice changes nothing, so a retry is safe.
 */
export async function requestWorkspaceDeletion(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<DeletionState> {
  requirePermission(context, "organization:delete");
  const input = requestDeletionSchema.safeParse(rawInput);
  if (!input.success || input.data.confirm.toLowerCase() !== context.organization.slug) {
    throw new AppError("INVALID_INPUT", "The confirmation does not match the workspace address.");
  }

  return prisma.$transaction(async (tx) => {
    // The conditional update is the idempotency guard: only the first request sets the date.
    const claimed = await tx.organization.updateMany({
      where: { id: context.organization.id, deletionRequestedAt: null },
      data: { deletionRequestedAt: now, deletionRequestedBy: context.userId },
    });
    const row = await tx.organization.findUniqueOrThrow({
      where: { id: context.organization.id },
      select: { deletionRequestedAt: true },
    });
    const requestedAt = row.deletionRequestedAt as Date;
    if (claimed.count === 1) {
      await recordAuditEvent(tx, {
        organizationId: context.organization.id,
        actorId: context.userId,
        action: "organization.deletion_requested",
        resourceType: "organization",
        resourceId: context.organization.id,
        metadata: { dueAfter: dueAfter(requestedAt).toISOString() },
        correlationId,
      });
    }
    return { requestedAt, dueAfter: dueAfter(requestedAt) };
  });
}

/** The owner withdraws the request. Nothing happens when there is no request. */
export async function cancelWorkspaceDeletion(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
): Promise<void> {
  requirePermission(context, "organization:delete");
  await prisma.$transaction(async (tx) => {
    const cleared = await tx.organization.updateMany({
      where: { id: context.organization.id, deletionRequestedAt: { not: null } },
      data: { deletionRequestedAt: null, deletionRequestedBy: null },
    });
    if (cleared.count === 1) {
      await recordAuditEvent(tx, {
        organizationId: context.organization.id,
        actorId: context.userId,
        action: "organization.deletion_cancelled",
        resourceType: "organization",
        resourceId: context.organization.id,
        correlationId,
      });
    }
  });
}
