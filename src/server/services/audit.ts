import "server-only";
import type { Prisma } from "@/generated/prisma/client";

export type AuditEvent = {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Safe, minimal metadata. Never include secrets, tokens or content bodies. */
  metadata?: Prisma.InputJsonObject;
  correlationId?: string | null;
};

type AuditWriter = Pick<Prisma.TransactionClient, "auditLog">;

/** Appends an audit event. Pass the transaction client to keep it atomic with the change. */
export async function recordAuditEvent(client: AuditWriter, event: AuditEvent): Promise<void> {
  await client.auditLog.create({
    data: {
      organizationId: event.organizationId,
      actorId: event.actorId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      metadata: event.metadata,
      correlationId: event.correlationId ?? null,
    },
  });
}
