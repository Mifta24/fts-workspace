import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  channelIdSchema,
  createChannelSchema,
  dmKeyFor,
  EDIT_WINDOW_MS,
  messageBodySchema,
  messageIdSchema,
  MESSAGES_PER_MINUTE,
  pageSchema,
  userIdSchema,
} from "@/features/chat/schemas/chat";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { publishRealtime } from "@/server/realtime/publisher";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

export type ChannelView = {
  id: string;
  type: "CHANNEL" | "DM";
  /** Channel name, or the other participant's name for a DM. */
  name: string;
  isPrivate: boolean;
  unread: number;
};

export type MessageView = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string | null;
  /** Empty for deleted messages. */
  body: string;
  edited: boolean;
  deleted: boolean;
  /** The caller wrote it and is still inside the edit window. */
  editable: boolean;
  createdAt: Date;
};

export type MessagePage = { messages: MessageView[]; nextCursor: string | null };

const channelNotFound = () => new AppError("NOT_FOUND", "Channel not found.");
const messageNotFound = () => new AppError("NOT_FOUND", "Message not found.");

/** Channels the caller belongs to (with unread counts) and public channels they could join. */
export async function listChannels(
  { prisma }: Deps,
  context: OrganizationContext,
): Promise<{ joined: ChannelView[]; available: ChannelView[] }> {
  requirePermission(context, "chat:read");
  const organizationId = context.organization.id;

  const memberships = await prisma.channelMember.findMany({
    where: { organizationId, userId: context.userId },
    include: { channel: { include: { members: { select: { userId: true } } } } },
    orderBy: { channel: { name: "asc" } },
    take: 200,
  });

  // Names of DM counterparts, restricted to people who belong to this organization.
  const peerIds = [
    ...new Set(
      memberships.flatMap(({ channel }) =>
        channel.type === "DM"
          ? channel.members.map((member) => member.userId).filter((id) => id !== context.userId)
          : [],
      ),
    ),
  ];
  const peers = await prisma.user.findMany({
    where: { id: { in: peerIds }, memberships: { some: { organizationId } } },
    select: { id: true, name: true },
  });
  const peerNames = new Map(peers.map((peer) => [peer.id, peer.name]));

  const joined = await Promise.all(
    memberships.map(async ({ channel, lastReadAt }): Promise<ChannelView> => {
      const peerId = channel.members.find((member) => member.userId !== context.userId)?.userId;
      const unread = await prisma.message.count({
        where: {
          organizationId,
          channelId: channel.id,
          authorId: { not: context.userId },
          deletedAt: null,
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
      return {
        id: channel.id,
        type: channel.type,
        name:
          channel.type === "DM"
            ? ((peerId && peerNames.get(peerId)) ?? "—")
            : (channel.name ?? "—"),
        isPrivate: channel.isPrivate,
        unread,
      };
    }),
  );

  const available = await prisma.channel.findMany({
    where: {
      organizationId,
      type: "CHANNEL",
      isPrivate: false,
      members: { none: { userId: context.userId } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return {
    joined,
    available: available.map((channel) => ({
      id: channel.id,
      type: "CHANNEL",
      name: channel.name ?? "—",
      isPrivate: false,
      unread: 0,
    })),
  };
}

export async function createChannel(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(context, "chat:manage");
  const parsed = createChannelSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Channel details are invalid.");
  const organizationId = context.organization.id;
  try {
    return await prisma.$transaction(async (tx) => {
      const channel = await tx.channel.create({
        data: {
          organizationId,
          type: "CHANNEL",
          name: parsed.data.name,
          isPrivate: parsed.data.isPrivate,
          createdById: context.userId,
          members: { create: { userId: context.userId } },
        },
        select: { id: true },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorId: context.userId,
        action: "channel.created",
        resourceType: "channel",
        resourceId: channel.id,
        metadata: { isPrivate: parsed.data.isPrivate },
        correlationId,
      });
      return channel;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "A channel with this name already exists.");
    }
    throw error;
  }
}

/** Joins a public channel. Private channels and DMs are indistinguishable from missing ones. */
export async function joinChannel(
  { prisma }: Deps,
  context: OrganizationContext,
  channelId: string,
): Promise<void> {
  requirePermission(context, "chat:read");
  const id = channelIdSchema.safeParse(channelId);
  if (!id.success) throw channelNotFound();
  const organizationId = context.organization.id;
  const channel = await prisma.channel.findFirst({
    where: { id: id.data, organizationId, type: "CHANNEL", isPrivate: false },
    select: { id: true },
  });
  if (!channel) throw channelNotFound();
  await prisma.channelMember.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: context.userId } },
    update: {},
    create: { organizationId, channelId: channel.id, userId: context.userId },
  });
}

/** Adds an active organization member to a channel (managers; never to DMs). */
export async function addChannelMember(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  channelId: string,
  userId: string,
): Promise<void> {
  requirePermission(context, "chat:manage");
  const channel = channelIdSchema.safeParse(channelId);
  const user = userIdSchema.safeParse(userId);
  if (!channel.success) throw channelNotFound();
  if (!user.success) throw new AppError("INVALID_INPUT", "User is invalid.");
  const organizationId = context.organization.id;

  await prisma.$transaction(async (tx) => {
    // Managers must themselves belong to a channel to add people to it.
    const own = await tx.channelMember.findFirst({
      where: {
        channelId: channel.data,
        organizationId,
        userId: context.userId,
        channel: { type: "CHANNEL" },
      },
      select: { id: true },
    });
    if (!own) throw channelNotFound();
    const target = await tx.member.findFirst({
      where: { organizationId, userId: user.data, status: "ACTIVE" },
      select: { id: true },
    });
    if (!target) throw new AppError("UNPROCESSABLE", "The user must be an active member.");
    await tx.channelMember.upsert({
      where: { channelId_userId: { channelId: channel.data, userId: user.data } },
      update: {},
      create: { organizationId, channelId: channel.data, userId: user.data },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "channel.member_added",
      resourceType: "channel",
      resourceId: channel.data,
      metadata: { userId: user.data },
      correlationId,
    });
  });
}

/** Finds or creates the direct-message channel between the caller and another active member. */
export async function startDirectMessage(
  { prisma }: Deps,
  context: OrganizationContext,
  otherUserId: string,
): Promise<{ id: string }> {
  requirePermission(context, "chat:post");
  const other = userIdSchema.safeParse(otherUserId);
  if (!other.success || other.data === context.userId) {
    throw new AppError("INVALID_INPUT", "Choose another member.");
  }
  const organizationId = context.organization.id;
  const target = await prisma.member.findFirst({
    where: { organizationId, userId: other.data, status: "ACTIVE" },
    select: { id: true },
  });
  if (!target) throw new AppError("UNPROCESSABLE", "The user must be an active member.");

  const dmKey = dmKeyFor(context.userId, other.data);
  const existing = await prisma.channel.findUnique({
    where: { organizationId_dmKey: { organizationId, dmKey } },
    select: { id: true },
  });
  if (existing) return existing;
  try {
    return await prisma.channel.create({
      data: {
        organizationId,
        type: "DM",
        isPrivate: true,
        dmKey,
        createdById: context.userId,
        members: {
          create: [{ userId: context.userId }, { userId: other.data }],
        },
      },
      select: { id: true },
    });
  } catch (error) {
    // Two people opening the same DM at once: the loser reads the winner's channel.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.channel.findUniqueOrThrow({
        where: { organizationId_dmKey: { organizationId, dmKey } },
        select: { id: true },
      });
    }
    throw error;
  }
}

/** Channel the caller belongs to, else NOT_FOUND (so private channels and DMs never leak). */
export async function assertChannelMember(
  prisma: Pick<PrismaClient, "channelMember">,
  context: OrganizationContext,
  channelId: string,
) {
  const id = channelIdSchema.safeParse(channelId);
  if (!id.success) throw channelNotFound();
  const membership = await prisma.channelMember.findFirst({
    where: { channelId: id.data, organizationId: context.organization.id, userId: context.userId },
    select: { channel: { select: { id: true, type: true, isPrivate: true } } },
  });
  if (!membership) throw channelNotFound();
  return membership.channel;
}

export async function listMessages(
  { prisma }: Deps,
  context: OrganizationContext,
  channelId: string,
  rawPage: unknown = {},
  now: Date = new Date(),
): Promise<MessagePage> {
  requirePermission(context, "chat:read");
  const page = pageSchema.safeParse(rawPage);
  if (!page.success) throw new AppError("INVALID_INPUT", "Pagination is invalid.");
  const channel = await assertChannelMember(prisma, context, channelId);
  const organizationId = context.organization.id;

  let cursor: { createdAt: Date; id: string } | undefined;
  if (page.data.before) {
    const anchor = await prisma.message.findFirst({
      where: { id: page.data.before, organizationId, channelId: channel.id },
      select: { createdAt: true, id: true },
    });
    if (!anchor) throw new AppError("INVALID_INPUT", "Pagination is invalid.");
    cursor = anchor;
  }

  const rows = await prisma.message.findMany({
    where: {
      organizationId,
      channelId: channel.id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.data.limit + 1,
  });
  const hasMore = rows.length > page.data.limit;
  const pageRows = rows.slice(0, page.data.limit);
  const views = await toViews(prisma, context, pageRows, now);
  return {
    messages: views.reverse(),
    nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
  };
}

export async function postMessage(
  { prisma }: Deps,
  context: OrganizationContext,
  channelId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<MessageView> {
  requirePermission(context, "chat:post");
  const parsed = messageBodySchema.safeParse(rawInput);
  if (!parsed.success)
    throw new AppError("INVALID_INPUT", "Write a message of up to 4000 characters.");
  const organizationId = context.organization.id;

  const { message, notified } = await prisma.$transaction(async (tx) => {
    const channel = await assertChannelMember(tx, context, channelId);
    const recent = await tx.message.count({
      where: {
        organizationId,
        authorId: context.userId,
        createdAt: { gt: new Date(now.getTime() - 60_000) },
      },
    });
    if (recent >= MESSAGES_PER_MINUTE) {
      throw new AppError("RATE_LIMITED", "You are sending messages too quickly.");
    }
    const row = await tx.message.create({
      data: {
        organizationId,
        channelId: channel.id,
        authorId: context.userId,
        body: parsed.data.body,
      },
    });
    let notified: Awaited<ReturnType<typeof createNotifications>> = [];
    if (channel.type === "DM") {
      const peers = await tx.channelMember.findMany({
        where: { channelId: channel.id, organizationId, userId: { not: context.userId } },
        select: { userId: true },
      });
      notified = await createNotifications(
        tx,
        peers.map((peer) => ({
          organizationId,
          userId: peer.userId,
          type: "DIRECT_MESSAGE" as const,
          actorId: context.userId,
          resourceType: "channel",
          resourceId: channel.id,
        })),
      );
    }
    return { message: row, notified };
  });

  await publishRealtime({
    type: "message.created",
    organizationId,
    channelId: message.channelId,
    messageId: message.id,
  });
  await publishNotifications(notified);
  return (await toViews(prisma, context, [message], now))[0]!;
}

/** Authors can edit their own message for 15 minutes. */
export async function editMessage(
  { prisma }: Deps,
  context: OrganizationContext,
  messageId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "chat:post");
  const id = messageIdSchema.safeParse(messageId);
  if (!id.success) throw messageNotFound();
  const parsed = messageBodySchema.safeParse(rawInput);
  if (!parsed.success)
    throw new AppError("INVALID_INPUT", "Write a message of up to 4000 characters.");
  const organizationId = context.organization.id;

  const message = await prisma.$transaction(async (tx) => {
    const existing = await tx.message.findFirst({
      where: { id: id.data, organizationId },
      select: { id: true, channelId: true, authorId: true, createdAt: true, deletedAt: true },
    });
    if (!existing) throw messageNotFound();
    await assertChannelMember(tx, context, existing.channelId);
    if (existing.authorId !== context.userId) {
      throw new AppError("FORBIDDEN", "You can only edit your own messages.");
    }
    if (existing.deletedAt) throw new AppError("UNPROCESSABLE", "This message was deleted.");
    if (now.getTime() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new AppError("UNPROCESSABLE", "Messages can only be edited for 15 minutes.");
    }
    await tx.message.update({
      where: { id: existing.id },
      data: { body: parsed.data.body, editedAt: now },
    });
    return existing;
  });
  await publishRealtime({
    type: "message.updated",
    organizationId,
    channelId: message.channelId,
    messageId: message.id,
  });
}

/**
 * Authors delete their own messages. Admins (`chat:moderate`) may also delete in public
 * channels and in private channels they belong to; DMs can only be deleted by their author.
 */
export async function deleteMessage(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  messageId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "chat:read");
  const id = messageIdSchema.safeParse(messageId);
  if (!id.success) throw messageNotFound();
  const organizationId = context.organization.id;

  const message = await prisma.$transaction(async (tx) => {
    const existing = await tx.message.findFirst({
      where: { id: id.data, organizationId },
      select: {
        id: true,
        channelId: true,
        authorId: true,
        deletedAt: true,
        channel: { select: { type: true, isPrivate: true } },
      },
    });
    if (!existing) throw messageNotFound();
    const isAuthor = existing.authorId === context.userId;
    const member = await tx.channelMember.findFirst({
      where: { channelId: existing.channelId, organizationId, userId: context.userId },
      select: { id: true },
    });
    const canModerate =
      !isAuthor &&
      context.permissions.includes("chat:moderate") &&
      existing.channel.type === "CHANNEL" &&
      (!existing.channel.isPrivate || member !== null);
    if (!member && !canModerate) throw messageNotFound();
    if (!isAuthor && !canModerate)
      throw new AppError("FORBIDDEN", "You cannot delete this message.");
    if (existing.deletedAt) return existing;

    await tx.message.update({ where: { id: existing.id }, data: { body: "", deletedAt: now } });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "message.deleted",
      resourceType: "message",
      resourceId: existing.id,
      metadata: { channelId: existing.channelId, moderated: !isAuthor },
      correlationId,
    });
    return existing;
  });
  await publishRealtime({
    type: "message.updated",
    organizationId,
    channelId: message.channelId,
    messageId: message.id,
  });
}

export async function markChannelRead(
  { prisma }: Deps,
  context: OrganizationContext,
  channelId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "chat:read");
  const channel = await assertChannelMember(prisma, context, channelId);
  await prisma.channelMember.updateMany({
    where: {
      channelId: channel.id,
      organizationId: context.organization.id,
      userId: context.userId,
    },
    data: { lastReadAt: now },
  });
}

/** Single message in a channel the caller belongs to; used by the gateway and clients after an event. */
export async function getMessage(
  { prisma }: Deps,
  context: OrganizationContext,
  messageId: string,
): Promise<MessageView> {
  requirePermission(context, "chat:read");
  const id = messageIdSchema.safeParse(messageId);
  if (!id.success) throw messageNotFound();
  const row = await prisma.message.findFirst({
    where: { id: id.data, organizationId: context.organization.id },
  });
  if (!row) throw messageNotFound();
  await assertChannelMember(prisma, context, row.channelId);
  return (await toViews(prisma, context, [row], new Date()))[0]!;
}

async function toViews(
  prisma: PrismaClient,
  context: OrganizationContext,
  rows: {
    id: string;
    channelId: string;
    authorId: string;
    body: string;
    editedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
  }[],
  now: Date,
): Promise<MessageView[]> {
  const organizationId = context.organization.id;
  const authorIds = [...new Set(rows.map((row) => row.authorId))];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds }, memberships: { some: { organizationId } } },
    select: { id: true, name: true },
  });
  const names = new Map(authors.map((author) => [author.id, author.name]));
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: names.get(row.authorId) ?? null,
    body: row.deletedAt ? "" : row.body,
    edited: row.editedAt !== null,
    deleted: row.deletedAt !== null,
    editable:
      row.authorId === context.userId &&
      row.deletedAt === null &&
      now.getTime() - row.createdAt.getTime() <= EDIT_WINDOW_MS,
    createdAt: row.createdAt,
  }));
}
