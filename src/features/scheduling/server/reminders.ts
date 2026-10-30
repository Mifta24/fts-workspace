import type { PrismaClient } from "@/generated/prisma/client";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import { reminderPayloadSchema } from "@/features/scheduling/schemas/scheduling";
import type { ClaimedJob } from "@/server/jobs/queue";

/**
 * Worker-side reminder for one meeting. Everything is re-read from the database for the job's
 * own organization, so a cancelled, moved or already started meeting sends nothing, and people
 * who declined (or left the organization) are not reminded.
 */
export async function sendAppointmentReminder(
  deps: { prisma: PrismaClient },
  job: ClaimedJob,
  now: Date = new Date(),
): Promise<void> {
  const payload = reminderPayloadSchema.safeParse(job.payload);
  if (!payload.success) throw new Error("Invalid reminder payload");
  const { prisma } = deps;

  const appointment = await prisma.appointment.findFirst({
    where: { id: payload.data.appointmentId, organizationId: job.organizationId },
    include: { attendees: true },
  });
  if (!appointment || appointment.status !== "SCHEDULED") return;
  if (appointment.startsAt.toISOString() !== payload.data.startsAt) return; // moved since queued
  if (appointment.reminderMinutes === 0) return;
  if (appointment.startsAt.getTime() <= now.getTime()) return; // too late to be a reminder

  const notified = await prisma.$transaction((tx) =>
    createNotifications(
      tx,
      appointment.attendees
        .filter((attendee) => attendee.response !== "DECLINED")
        .map((attendee) => ({
          organizationId: job.organizationId,
          userId: attendee.userId,
          type: "APPOINTMENT_REMINDER" as const,
          actorId: null,
          resourceType: "appointment",
          resourceId: appointment.id,
        })),
    ),
  );
  await publishNotifications(notified);
}
