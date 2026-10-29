import "server-only";
import type { NotificationType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { publishRealtime } from "@/server/realtime/publisher";

type Deps = { prisma: PrismaClient };
type Tx = Prisma.TransactionClient;

export type NotificationView = {
  id: string;
  type: NotificationType;
  actorName: string | null;
  resourceType: string;
  resourceId: string;
  /** Task title for task notifications, resolved from current data inside the tenant. */
  resourceTitle: string | null;
  read: boolean;
  createdAt: Date;
};

export type NewNotification = {
  organizationId: string;
  userId: string;
  type: NotificationType;
  actorId: string;
  resourceType: string;
  resourceId: string;
};

const PAGE = 50;

/**
 * Creates notifications inside the caller's transaction. Recipients must be ACTIVE members
 * of the same organization, and nobody is notified about their own actions.
 * Returns the ids so the caller can publish realtime events after commit.
 */
export async function createNotifications(
  tx: Tx,
  items: NewNotification[],
): Promise<{ organizationId: string; userId: string; notificationId: string }[]> {
  const created: { organizationId: string; userId: string; notificationId: string }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.userId === item.actorId) continue;
    const key = `${item.userId}:${item.type}:${item.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const recipient = await tx.member.findFirst({
      where: { organizationId: item.organizationId, userId: item.userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!recipient) continue;
    // Coalesce: one unread notification per recipient, type and resource is enough.
    const unread = await tx.notification.findFirst({
      where: {
        organizationId: item.organizationId,
        userId: item.userId,
        type: item.type,
        resourceId: item.resourceId,
        readAt: null,
      },
      select: { id: true },
    });
    if (unread) continue;
    const row = await tx.notification.create({ data: item, select: { id: true } });
    created.push({
      organizationId: item.organizationId,
      userId: item.userId,
      notificationId: row.id,
    });
  }
  return created;
}

export async function publishNotifications(
  created: { organizationId: string; userId: string; notificationId: string }[],
): Promise<void> {
  await Promise.all(
    created.map((event) => publishRealtime({ type: "notification.created", ...event })),
  );
}

/** The caller's own notifications only; the user id always comes from the resolved context. */
export async function listNotifications(
  { prisma }: Deps,
  context: OrganizationContext,
  options: { unreadOnly?: boolean } = {},
): Promise<NotificationView[]> {
  requirePermission(context, "notification:read");
  const organizationId = context.organization.id;
  const rows = await prisma.notification.findMany({
    where: {
      organizationId,
      userId: context.userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE,
  });
  const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
  const taskIds = rows.filter((row) => row.resourceType === "task").map((row) => row.resourceId);
  const [actors, tasks] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: actorIds }, memberships: { some: { organizationId } } },
      select: { id: true, name: true },
    }),
    prisma.task.findMany({
      where: { organizationId, id: { in: taskIds } },
      select: { id: true, title: true },
    }),
  ]);
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    actorName: row.actorId ? (actorNames.get(row.actorId) ?? null) : null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceTitle: row.resourceType === "task" ? (taskTitles.get(row.resourceId) ?? null) : null,
    read: row.readAt !== null,
    createdAt: row.createdAt,
  }));
}

export async function countUnread({ prisma }: Deps, context: OrganizationContext): Promise<number> {
  requirePermission(context, "notification:read");
  return prisma.notification.count({
    where: { organizationId: context.organization.id, userId: context.userId, readAt: null },
  });
}

export async function markNotificationRead(
  { prisma }: Deps,
  context: OrganizationContext,
  notificationId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "notification:read");
  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      organizationId: context.organization.id,
      userId: context.userId,
    },
    data: { readAt: now },
  });
  if (result.count === 0) throw new AppError("NOT_FOUND", "Notification not found.");
}

export async function markAllNotificationsRead(
  { prisma }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<number> {
  requirePermission(context, "notification:read");
  const result = await prisma.notification.updateMany({
    where: { organizationId: context.organization.id, userId: context.userId, readAt: null },
    data: { readAt: now },
  });
  return result.count;
}
