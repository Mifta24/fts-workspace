import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import {
  BOOKINGS_PER_DAY,
  BOOKINGS_PER_MINUTE,
  bookingPageIdSchema,
  createBookingPageSchema,
  MAX_PUBLIC_BODY_CHARS,
  publicTokenSchema,
  statusSchema,
  UPCOMING_PER_EMAIL,
  updateBookingPageSchema,
  visitorBookingSchema,
} from "@/features/booking/schemas/booking";
import { computeSlots, type SlotRules } from "@/features/booking/schemas/slots";
import { captureVisitorContact } from "@/features/crm/server/crm-service";
import { publicPagesOpen, requireFeature } from "@/features/billing/server/entitlements";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { planReminder } from "@/features/scheduling/server/scheduling-service";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember, lockTree } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; correlationId?: string };
type Tx = Prisma.TransactionClient;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const notFound = () => new AppError("NOT_FOUND", "Booking page not found.");

export type BookingPageView = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  durationMinutes: number;
  timeZone: string;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  consentText: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  publicToken: string;
  upcomingBookings: number;
};

const toView = (
  row: Prisma.BookingPageGetPayload<object>,
  upcomingBookings: number,
): BookingPageView => ({
  id: row.id,
  title: row.title,
  description: row.description,
  location: row.location,
  durationMinutes: row.durationMinutes,
  timeZone: row.timeZone,
  weekdays: row.weekdays,
  startMinute: row.startMinute,
  endMinute: row.endMinute,
  minNoticeHours: row.minNoticeHours,
  maxDaysAhead: row.maxDaysAhead,
  consentText: row.consentText,
  status: row.status,
  publicToken: row.publicToken,
  upcomingBookings,
});

const rulesOf = (page: Prisma.BookingPageGetPayload<object>): SlotRules => ({
  durationMinutes: page.durationMinutes,
  timeZone: page.timeZone,
  weekdays: page.weekdays,
  startMinute: page.startMinute,
  endMinute: page.endMinute,
  minNoticeHours: page.minNoticeHours,
  maxDaysAhead: page.maxDaysAhead,
});

/** Meetings that keep the owner busy: scheduled, and not declined by them. */
async function ownerBusy(
  client: Pick<Tx, "appointment">,
  organizationId: string,
  ownerId: string,
  now: Date,
  maxDaysAhead: number,
) {
  return client.appointment.findMany({
    where: {
      organizationId,
      status: "SCHEDULED",
      endsAt: { gt: now },
      startsAt: { lt: new Date(now.getTime() + (maxDaysAhead + 1) * DAY) },
      attendees: { some: { userId: ownerId, response: { not: "DECLINED" } } },
    },
    select: { startsAt: true, endsAt: true },
  });
}

/* ------------------------------ management ------------------------------ */

async function ownPage(tx: Pick<Tx, "bookingPage">, context: OrganizationContext, id: string) {
  const parsed = bookingPageIdSchema.safeParse(id);
  if (!parsed.success) throw notFound();
  // Pages belong to the member who made them: other members, admins included, cannot see them.
  const page = await tx.bookingPage.findFirst({
    where: { id: parsed.data, organizationId: context.organization.id, ownerId: context.userId },
  });
  if (!page) throw notFound();
  return page;
}

export async function createBookingPage(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(context, "booking:manage");
  const parsed = createBookingPageSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Booking page details are invalid.");
  const input = parsed.data;
  return prisma.$transaction(async (tx) => {
    await assertActiveMember(
      tx,
      context.organization.id,
      context.userId,
      "The owner must be an active member.",
    );
    const page = await tx.bookingPage.create({
      data: {
        organizationId: context.organization.id,
        ownerId: context.userId,
        title: input.title,
        description: input.description,
        location: input.location,
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
        weekdays: input.weekdays,
        startMinute: input.start,
        endMinute: input.end,
        minNoticeHours: input.minNoticeHours,
        maxDaysAhead: input.maxDaysAhead,
        consentText: input.consentText,
        // 128 random bits: unguessable, and unrelated to the page's id.
        publicToken: randomBytes(16).toString("base64url"),
      },
      select: { id: true },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "booking_page.created",
      resourceType: "booking_page",
      resourceId: page.id,
      correlationId,
    });
    return page;
  });
}

async function upcomingCounts(prisma: Pick<PrismaClient, "appointment">, ids: string[], now: Date) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await prisma.appointment.groupBy({
    by: ["bookingPageId"],
    where: { bookingPageId: { in: ids }, status: "SCHEDULED", startsAt: { gt: now } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.bookingPageId, row._count._all]));
}

export async function listBookingPages(
  { prisma }: Deps,
  context: OrganizationContext,
  now: Date = new Date(),
): Promise<BookingPageView[]> {
  requirePermission(context, "booking:manage");
  const rows = await prisma.bookingPage.findMany({
    where: { organizationId: context.organization.id, ownerId: context.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  const counts = await upcomingCounts(
    prisma,
    rows.map((row) => row.id),
    now,
  );
  return rows.map((row) => toView(row, counts.get(row.id) ?? 0));
}

export async function getBookingPage(
  { prisma }: Deps,
  context: OrganizationContext,
  id: string,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(context, "booking:manage");
  const page = await ownPage(prisma, context, id);
  const counts = await upcomingCounts(prisma, [page.id], now);
  return toView(page, counts.get(page.id) ?? 0);
}

export async function updateBookingPage(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  id: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(context, "booking:manage");
  const parsed = updateBookingPageSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Booking page details are invalid.");
  const input = parsed.data;
  await prisma.$transaction(async (tx) => {
    const page = await ownPage(tx, context, id);
    // The wording visitors agreed to is not rewritten once the page has been public.
    if (
      input.consentText !== undefined &&
      page.status !== "DRAFT" &&
      input.consentText !== page.consentText
    ) {
      throw new AppError(
        "UNPROCESSABLE",
        "The consent wording can only change while the page is a draft.",
      );
    }
    await tx.bookingPage.update({
      where: { id: page.id },
      data: {
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        durationMinutes: input.durationMinutes,
        timeZone: input.timeZone,
        weekdays: input.weekdays,
        startMinute: input.start,
        endMinute: input.end,
        minNoticeHours: input.minNoticeHours,
        maxDaysAhead: input.maxDaysAhead,
        ...(input.consentText !== undefined ? { consentText: input.consentText } : {}),
      },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "booking_page.updated",
      resourceType: "booking_page",
      resourceId: page.id,
      correlationId,
    });
  });
}

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["CLOSED"],
  CLOSED: ["PUBLISHED"],
};

export async function setBookingPageStatus(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  id: string,
  rawStatus: unknown,
): Promise<void> {
  requirePermission(context, "booking:manage");
  const status = statusSchema.safeParse(rawStatus);
  if (!status.success) throw new AppError("INVALID_INPUT", "Choose a status.");
  await prisma.$transaction(async (tx) => {
    const page = await ownPage(tx, context, id);
    if (page.status === status.data) return;
    if (!TRANSITIONS[page.status]?.includes(status.data)) {
      throw new AppError("UNPROCESSABLE", "This status change is not allowed.");
    }
    if (status.data === "PUBLISHED") {
      await requireFeature(tx, context.organization.id, "publicPages");
      await assertActiveMember(
        tx,
        context.organization.id,
        page.ownerId,
        "The page owner must be an active member.",
      );
    }
    await tx.bookingPage.update({ where: { id: page.id }, data: { status: status.data } });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "booking_page.status_changed",
      resourceType: "booking_page",
      resourceId: page.id,
      metadata: { from: page.status, to: status.data },
      correlationId,
    });
  });
}

/* ------------------------------- visitors -------------------------------- */

export type PublicBookingPage = {
  title: string;
  description: string | null;
  location: string | null;
  organizationName: string;
  durationMinutes: number;
  timeZone: string;
  consentText: string;
  slots: Date[];
};

/** A published page whose owner is still an active member; anything else looks like no page. */
async function livePage(prisma: PrismaClient, rawToken: string) {
  const token = publicTokenSchema.safeParse(rawToken);
  if (!token.success) throw notFound();
  const page = await prisma.bookingPage.findUnique({
    where: { publicToken: token.data },
    include: { organization: { select: { id: true, name: true, suspendedAt: true } } },
  });
  if (!page || page.status !== "PUBLISHED") throw notFound();
  if (!(await publicPagesOpen(prisma, page.organization))) throw notFound();
  const owner = await prisma.member.findFirst({
    where: { organizationId: page.organizationId, userId: page.ownerId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw notFound();
  return page;
}

/** What an anonymous visitor may see: the page's wording and its free slots, nothing about why a time is taken. */
export async function getPublicBookingPage(
  { prisma }: Pick<Deps, "prisma">,
  rawToken: string,
  now: Date = new Date(),
): Promise<PublicBookingPage> {
  const page = await livePage(prisma as PrismaClient, rawToken);
  const busy = await ownerBusy(prisma, page.organizationId, page.ownerId, now, page.maxDaysAhead);
  return {
    title: page.title,
    description: page.description,
    location: page.location,
    organizationName: page.organization.name,
    durationMinutes: page.durationMinutes,
    timeZone: page.timeZone,
    consentText: page.consentText,
    slots: computeSlots(rulesOf(page), busy, now),
  };
}

export type BookingConfirmation = { title: string; startsAt: Date; endsAt: Date; timeZone: string };

/**
 * Books a slot for an anonymous visitor. The page is found by its token only; the organization,
 * owner, duration and the offered slots all come from the stored page, and the chosen start is
 * accepted only if the server would have offered it right now. Consent is required and recorded.
 */
export async function bookPublicSlot(
  { prisma, correlationId }: Deps,
  rawToken: string,
  rawInput: unknown,
  consentAccepted: boolean,
  now: Date = new Date(),
): Promise<BookingConfirmation> {
  if (JSON.stringify(rawInput ?? null).length > MAX_PUBLIC_BODY_CHARS) {
    throw new AppError("INVALID_INPUT", "The request is too large.");
  }
  const page = await livePage(prisma, rawToken);
  const parsed = visitorBookingSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Please check your details.");
  if (!consentAccepted) {
    throw new AppError("INVALID_INPUT", "You need to accept the consent statement.");
  }
  const input = parsed.data;
  const organizationId = page.organizationId;

  const [lastMinute, lastDay, upcomingForEmail] = await Promise.all([
    prisma.appointment.count({
      where: { bookingPageId: page.id, createdAt: { gt: new Date(now.getTime() - MINUTE) } },
    }),
    prisma.appointment.count({
      where: { bookingPageId: page.id, createdAt: { gt: new Date(now.getTime() - DAY) } },
    }),
    prisma.appointment.count({
      where: {
        bookingPageId: page.id,
        status: "SCHEDULED",
        startsAt: { gt: now },
        contact: { email: input.email, erasedAt: null },
      },
    }),
  ]);
  if (lastMinute >= BOOKINGS_PER_MINUTE || lastDay >= BOOKINGS_PER_DAY) {
    throw new AppError("RATE_LIMITED", "Too many bookings. Please try again later.");
  }
  if (upcomingForEmail >= UPCOMING_PER_EMAIL) {
    throw new AppError("RATE_LIMITED", "You already have upcoming bookings with this page.");
  }

  const endsAt = new Date(input.startsAt.getTime() + page.durationMinutes * MINUTE);
  const notified = await prisma.$transaction(async (tx) => {
    await lockTree(tx, "schedule", organizationId);
    // Decided again under the lock, so two visitors cannot take the same slot.
    const busy = await ownerBusy(tx, organizationId, page.ownerId, now, page.maxDaysAhead);
    const offered = computeSlots(rulesOf(page), busy, now).some(
      (slot) => slot.getTime() === input.startsAt.getTime(),
    );
    if (!offered) throw new AppError("CONFLICT", "That time is no longer available.");

    const { contactId } = await captureVisitorContact(tx, {
      organizationId,
      ownerId: page.ownerId,
      name: input.name,
      email: input.email,
      source: `booking: ${page.title}`,
      now,
    });
    const appointment = await tx.appointment.create({
      data: {
        organizationId,
        title: page.title,
        description: input.note,
        location: page.location,
        startsAt: input.startsAt,
        endsAt,
        organizerId: page.ownerId,
        contactId,
        bookingPageId: page.id,
        attendees: { create: [{ userId: page.ownerId, response: "ACCEPTED" }] },
      },
      select: { id: true, reminderMinutes: true },
    });
    await planReminder(
      tx,
      {
        id: appointment.id,
        startsAt: input.startsAt,
        reminderMinutes: appointment.reminderMinutes,
      },
      organizationId,
      now,
    );
    // No actor and no visitor details: the trail holds the fact and the identifiers only.
    await recordAuditEvent(tx, {
      organizationId,
      actorId: null,
      action: "booking.created",
      resourceType: "appointment",
      resourceId: appointment.id,
      metadata: { bookingPageId: page.id },
      correlationId,
    });
    return createNotifications(tx, [
      {
        organizationId,
        userId: page.ownerId,
        type: "BOOKING_RECEIVED",
        actorId: null,
        resourceType: "appointment",
        resourceId: appointment.id,
      },
    ]);
  });
  await publishNotifications(notified);
  return { title: page.title, startsAt: input.startsAt, endsAt, timeZone: page.timeZone };
}
