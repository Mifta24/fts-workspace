import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { contactAccessWhere } from "@/features/crm/server/crm-service";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import {
  requirePermission,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import {
  appointmentIdSchema,
  createAppointmentSchema,
  MAX_HORIZON_DAYS,
  rescheduleSchema,
  responseSchema,
} from "@/features/scheduling/schemas/scheduling";
import { recordAuditEvent } from "@/server/services/audit";
import { assertActiveMember, lockTree } from "@/server/services/tenant-refs";

type Deps = { prisma: PrismaClient; correlationId?: string };
type Tx = Prisma.TransactionClient;

const MINUTE = 60_000;
const notFound = () => new AppError("NOT_FOUND", "Appointment not found.");

export type AppointmentView = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  organizerId: string;
  organizerName: string | null;
  /** Only shown when the viewer may see that CRM contact. */
  contactName: string | null;
  attendees: {
    userId: string;
    name: string | null;
    response: "PENDING" | "ACCEPTED" | "DECLINED";
  }[];
  myResponse: "PENDING" | "ACCEPTED" | "DECLINED" | null;
  mine: boolean;
};

/**
 * Throws CONFLICT when any of the people is already booked in an overlapping appointment they
 * have not declined. Callers hold the per-organization schedule lock, so two concurrent
 * bookings cannot both pass this check.
 */
async function assertNoConflicts(
  tx: Tx,
  organizationId: string,
  userIds: string[],
  startsAt: Date,
  endsAt: Date,
  ignoreAppointmentId?: string,
) {
  const clash = await tx.appointmentAttendee.findFirst({
    where: {
      organizationId,
      userId: { in: userIds },
      response: { not: "DECLINED" },
      appointment: {
        status: "SCHEDULED",
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(ignoreAppointmentId ? { id: { not: ignoreAppointmentId } } : {}),
      },
    },
    select: { id: true },
  });
  // The answer deliberately does not say who is busy or with what: that is their calendar.
  if (clash) throw new AppError("CONFLICT", "Someone is already booked at that time.");
}

function window(startsAt: Date, durationMinutes: number, now: Date) {
  if (startsAt.getTime() < now.getTime() - 5 * MINUTE) {
    throw new AppError("UNPROCESSABLE", "Choose a time in the future.");
  }
  if (startsAt.getTime() > now.getTime() + MAX_HORIZON_DAYS * 86_400_000) {
    throw new AppError("UNPROCESSABLE", "That date is too far ahead.");
  }
  return new Date(startsAt.getTime() + durationMinutes * MINUTE);
}

export async function createAppointment(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<{ id: string }> {
  requirePermission(context, "appointment:write");
  const parsed = createAppointmentSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Appointment details are invalid.");
  const input = parsed.data;
  const endsAt = window(input.startsAt, input.durationMinutes, now);
  const organizationId = context.organization.id;
  const guests = [...new Set(input.attendeeIds)].filter((id) => id !== context.userId);

  const { id, notified } = await prisma.$transaction(async (tx) => {
    for (const guest of guests) {
      await assertActiveMember(
        tx,
        organizationId,
        guest,
        "Every attendee must be an active member.",
      );
    }
    if (input.contactId) {
      if (!context.permissions.includes("crm:read")) {
        throw new AppError("FORBIDDEN", "You cannot link CRM contacts.");
      }
      const contact = await tx.crmContact.findFirst({
        where: { ...contactAccessWhere(context), id: input.contactId },
        select: { id: true },
      });
      if (!contact) throw new AppError("UNPROCESSABLE", "The contact is not available.");
    }
    await lockTree(tx, "schedule", organizationId);
    await assertNoConflicts(
      tx,
      organizationId,
      [context.userId, ...guests],
      input.startsAt,
      endsAt,
    );

    const appointment = await tx.appointment.create({
      data: {
        organizationId,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: input.startsAt,
        endsAt,
        organizerId: context.userId,
        contactId: input.contactId,
        attendees: {
          create: [
            { userId: context.userId, response: "ACCEPTED" },
            ...guests.map((userId) => ({ userId })),
          ],
        },
      },
      select: { id: true },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "appointment.created",
      resourceType: "appointment",
      resourceId: appointment.id,
      metadata: { attendees: guests.length + 1 },
      correlationId,
    });
    const notified = await createNotifications(
      tx,
      guests.map((userId) => ({
        organizationId,
        userId,
        type: "APPOINTMENT_INVITED" as const,
        actorId: context.userId,
        resourceType: "appointment",
        resourceId: appointment.id,
      })),
    );
    return { id: appointment.id, notified };
  });
  await publishNotifications(notified);
  return { id };
}

/** Appointments the caller organizes or attends, soonest first. */
export async function listAppointments(
  { prisma }: Deps,
  context: OrganizationContext,
  options: { from?: Date; to?: Date } = {},
  now: Date = new Date(),
): Promise<AppointmentView[]> {
  requirePermission(context, "appointment:read");
  const organizationId = context.organization.id;
  const from = options.from ?? now;
  const to = options.to ?? new Date(from.getTime() + 60 * 86_400_000);
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: "SCHEDULED",
      endsAt: { gt: from },
      startsAt: { lt: to },
      attendees: { some: { userId: context.userId } },
    },
    include: { attendees: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 200,
  });

  const userIds = [...new Set(rows.flatMap((row) => row.attendees.map((a) => a.userId)))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, memberships: { some: { organizationId } } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((user) => [user.id, user.name]));

  // A contact's name is shown only to people who are allowed to see that contact.
  const contactIds = [...new Set(rows.flatMap((row) => (row.contactId ? [row.contactId] : [])))];
  const visible =
    context.permissions.includes("crm:read") && contactIds.length > 0
      ? await prisma.crmContact.findMany({
          where: { ...contactAccessWhere(context), id: { in: contactIds } },
          select: { id: true, name: true },
        })
      : [];
  const contactNames = new Map(visible.map((contact) => [contact.id, contact.name]));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    organizerId: row.organizerId,
    organizerName: names.get(row.organizerId) ?? null,
    contactName: row.contactId ? (contactNames.get(row.contactId) ?? null) : null,
    attendees: row.attendees.map((a) => ({
      userId: a.userId,
      name: names.get(a.userId) ?? null,
      response: a.response,
    })),
    myResponse: row.attendees.find((a) => a.userId === context.userId)?.response ?? null,
    mine: row.organizerId === context.userId,
  }));
}

async function attendedAppointment(tx: Tx, context: OrganizationContext, appointmentId: string) {
  const id = appointmentIdSchema.safeParse(appointmentId);
  if (!id.success) throw notFound();
  const row = await tx.appointment.findFirst({
    where: {
      id: id.data,
      organizationId: context.organization.id,
      attendees: { some: { userId: context.userId } },
    },
    include: { attendees: true },
  });
  if (!row) throw notFound();
  return row;
}

export async function respondToAppointment(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  appointmentId: string,
  rawResponse: unknown,
): Promise<void> {
  requirePermission(context, "appointment:read");
  const response = responseSchema.safeParse(rawResponse);
  if (!response.success) throw new AppError("INVALID_INPUT", "Choose accept or decline.");
  await prisma.$transaction(async (tx) => {
    await lockTree(tx, "schedule", context.organization.id);
    const appointment = await attendedAppointment(tx, context, appointmentId);
    if (appointment.status !== "SCHEDULED")
      throw new AppError("UNPROCESSABLE", "This appointment was cancelled.");
    if (appointment.organizerId === context.userId) {
      throw new AppError("UNPROCESSABLE", "Organizers cancel instead of declining.");
    }
    const mine = appointment.attendees.find((a) => a.userId === context.userId)!;
    if (mine.response === response.data) return;
    if (response.data === "ACCEPTED" && mine.response === "DECLINED") {
      await assertNoConflicts(
        tx,
        context.organization.id,
        [context.userId],
        appointment.startsAt,
        appointment.endsAt,
        appointment.id,
      );
    }
    await tx.appointmentAttendee.update({
      where: { id: mine.id },
      data: { response: response.data },
    });
    await recordAuditEvent(tx, {
      organizationId: context.organization.id,
      actorId: context.userId,
      action: "appointment.responded",
      resourceType: "appointment",
      resourceId: appointment.id,
      metadata: { response: response.data },
      correlationId,
    });
  });
}

export async function rescheduleAppointment(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  appointmentId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(context, "appointment:write");
  const parsed = rescheduleSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Appointment details are invalid.");
  const endsAt = window(parsed.data.startsAt, parsed.data.durationMinutes, now);
  const organizationId = context.organization.id;
  const notified = await prisma.$transaction(async (tx) => {
    await lockTree(tx, "schedule", organizationId);
    const appointment = await attendedAppointment(tx, context, appointmentId);
    if (appointment.organizerId !== context.userId) throw notFound();
    if (appointment.status !== "SCHEDULED")
      throw new AppError("UNPROCESSABLE", "This appointment was cancelled.");
    const people = appointment.attendees.map((a) => a.userId);
    await assertNoConflicts(
      tx,
      organizationId,
      people,
      parsed.data.startsAt,
      endsAt,
      appointment.id,
    );
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { startsAt: parsed.data.startsAt, endsAt },
    });
    // Everyone but the organizer has to confirm the new time again.
    await tx.appointmentAttendee.updateMany({
      where: { appointmentId: appointment.id, organizationId, userId: { not: context.userId } },
      data: { response: "PENDING" },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "appointment.rescheduled",
      resourceType: "appointment",
      resourceId: appointment.id,
      correlationId,
    });
    return createNotifications(
      tx,
      people.map((userId) => ({
        organizationId,
        userId,
        type: "APPOINTMENT_UPDATED" as const,
        actorId: context.userId,
        resourceType: "appointment",
        resourceId: appointment.id,
      })),
    );
  });
  await publishNotifications(notified);
}

export async function cancelAppointment(
  { prisma, correlationId }: Deps,
  context: OrganizationContext,
  appointmentId: string,
): Promise<void> {
  requirePermission(context, "appointment:write");
  const organizationId = context.organization.id;
  const notified = await prisma.$transaction(async (tx) => {
    const appointment = await attendedAppointment(tx, context, appointmentId);
    if (appointment.organizerId !== context.userId) throw notFound();
    if (appointment.status === "CANCELLED") return [];
    await tx.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
    await recordAuditEvent(tx, {
      organizationId,
      actorId: context.userId,
      action: "appointment.cancelled",
      resourceType: "appointment",
      resourceId: appointment.id,
      correlationId,
    });
    return createNotifications(
      tx,
      appointment.attendees.map((a) => ({
        organizationId,
        userId: a.userId,
        type: "APPOINTMENT_CANCELLED" as const,
        actorId: context.userId,
        resourceType: "appointment",
        resourceId: appointment.id,
      })),
    );
  });
  await publishNotifications(notified);
}
