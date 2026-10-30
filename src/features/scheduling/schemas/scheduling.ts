import { z } from "zod";

export const MAX_ATTENDEES = 20;
export const MAX_HORIZON_DAYS = 730;
export const REMINDER_JOB = "appointment.reminder";
/** Lead times offered in the UI; 0 turns the reminder off. */
export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 1440] as const;
export const DEFAULT_REMINDER_MINUTES = 15;

const blank = (value: unknown) => (value === "" || value === null ? undefined : value);

export const createAppointmentSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.preprocess(blank, z.string().trim().max(2000).optional()),
  location: z.preprocess(blank, z.string().trim().max(200).optional()),
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(1440),
  attendeeIds: z.array(z.uuid()).max(MAX_ATTENDEES).default([]),
  contactId: z.preprocess(blank, z.uuid().optional()),
  reminderMinutes: z.preprocess(
    blank,
    z.coerce
      .number()
      .int()
      .refine((value) => (REMINDER_CHOICES as readonly number[]).includes(value))
      .default(DEFAULT_REMINDER_MINUTES),
  ),
});

export const rescheduleSchema = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(1440),
});

export const responseSchema = z.enum(["ACCEPTED", "DECLINED"]);
export const appointmentIdSchema = z.uuid();

export const reminderPayloadSchema = z.object({
  appointmentId: z.uuid(),
  /** The start the reminder was planned for; a rescheduled meeting makes the job obsolete. */
  startsAt: z.iso.datetime(),
});

export const timeZoneSchema = z.string().trim().min(1).max(64);
