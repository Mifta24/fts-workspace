import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

/** Serializes tree edits (goal/task parents) per organization for the rest of the transaction. */
export async function lockTree(tx: Tx, kind: string, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${kind}-tree:${organizationId}`}, 0))`;
}

/** Owners and assignees must be ACTIVE members of the same organization. */
export async function assertActiveMember(
  tx: Tx,
  organizationId: string,
  userId: string,
  message = "The user must be an active member.",
): Promise<void> {
  const member = await tx.member.findFirst({
    where: { organizationId, userId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!member) throw new AppError("UNPROCESSABLE", message);
}

export async function assertActiveProject(
  tx: Tx,
  organizationId: string,
  projectId: string,
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { id: projectId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!project) throw new AppError("UNPROCESSABLE", "The project is not available.");
}
