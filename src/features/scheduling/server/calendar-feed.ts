import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { buildIcs, type IcsEvent } from "@/features/scheduling/schemas/ics";
import { recordAuditEvent } from "@/server/services/audit";

type Deps = { prisma: PrismaClient; correlationId?: string };

const DAY = 86_400_000;
/** Meetings that ended up to a week ago stay in the feed, so a late sync still shows them. */
const PAST_DAYS = 7;
const FUTURE_DAYS = 365;
const MAX_EVENTS = 1000;
/** `lastUsedAt` is refreshed at most this often, so a polling client causes few writes. */
const TOUCH_EVERY_MS = 3_600_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type FeedStatus = { enabled: boolean; createdAt: Date | null; lastUsedAt: Date | null };

export async function getFeedStatus(
  { prisma }: Pick<Deps, "prisma">,
  context: OrganizationContext,
): Promise<FeedStatus> {
  requirePermission(context, "appointment:read");
  const feed = await prisma.calendarFeed.findUnique({
    where: {
      organizationId_userId: { organizationId: context.organization.id, userId: context.userId },
    },
    select: { createdAt: true, lastUsedAt: true },
  });
  return {
    enabled: feed !== null,
    createdAt: feed?.createdAt ?? null,
    lastUsedAt: feed?.lastUsedAt ?? null,
  };
}

/**
 * Creates the caller's subscription link, replacing any earlier one (which stops working at once).
 * The token is returned only here; the database keeps its hash.
 */
export async function createFeed(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<{ token: string }> {
  requirePermission(context, "appointment:read");
  const token = randomBytes(32).toString("base64url");
  const key = { organizationId: context.organization.id, userId: context.userId };
  await prisma.$transaction(async (tx) => {
    await tx.calendarFeed.upsert({
      where: { organizationId_userId: key },
      create: { ...key, tokenHash: hashToken(token), createdAt: now },
      update: { tokenHash: hashToken(token), createdAt: now, lastUsedAt: null },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "calendar_feed.created",
      resourceType: "calendar_feed",
      correlationId,
    });
  });
  return { token };
}

/** Turns the link off. Idempotent. */
export async function revokeFeed(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
): Promise<void> {
  requirePermission(context, "appointment:read");
  await prisma.$transaction(async (tx) => {
    const result = await tx.calendarFeed.deleteMany({
      where: { organizationId: context.organization.id, userId: context.userId },
    });
    if (result.count === 0) return;
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "calendar_feed.revoked",
      resourceType: "calendar_feed",
      correlationId,
    });
  });
}

/**
 * The calendar for a subscription token, or null when the token is unknown, revoked or its
 * owner is no longer an active member. Callers answer all of those the same way. The token
 * decides the person and the organization; nothing else in the request is trusted.
 */
export async function readFeed(
  { prisma }: Pick<Deps, "prisma">,
  rawToken: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (!TOKEN_PATTERN.test(rawToken)) return null;
  const feed = await prisma.calendarFeed.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!feed) return null;
  const { organizationId, userId } = feed;

  const member = await prisma.member.findFirst({
    where: { organizationId, userId, status: "ACTIVE", organization: { suspendedAt: null } },
    select: { id: true, organization: { select: { name: true } } },
  });
  if (!member) return null;

  if (!feed.lastUsedAt || now.getTime() - feed.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.calendarFeed.update({ where: { id: feed.id }, data: { lastUsedAt: now } });
  }

  const attendances = await prisma.appointmentAttendee.findMany({
    where: {
      organizationId,
      userId,
      response: { not: "DECLINED" },
      appointment: {
        status: "SCHEDULED",
        endsAt: { gt: new Date(now.getTime() - PAST_DAYS * DAY) },
        startsAt: { lt: new Date(now.getTime() + FUTURE_DAYS * DAY) },
      },
    },
    include: { appointment: true },
    orderBy: [{ appointment: { startsAt: "asc" } }, { id: "asc" }],
    take: MAX_EVENTS,
  });
  const events: IcsEvent[] = attendances.map(({ appointment, response }) => ({
    id: appointment.id,
    title: appointment.title,
    description: appointment.description,
    location: appointment.location,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    updatedAt: appointment.updatedAt,
    response: response === "ACCEPTED" ? "ACCEPTED" : "PENDING",
    reminderMinutes: appointment.reminderMinutes,
  }));
  return buildIcs(events, { calendarName: `${member.organization.name} meetings`, now });
}
