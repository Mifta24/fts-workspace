import { z } from "zod";

export const MAX_ATTENDEES = 20;
export const MAX_HORIZON_DAYS = 730;

const blank = (value: unknown) => (value === "" || value === null ? undefined : value);

export const createAppointmentSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.preprocess(blank, z.string().trim().max(2000).optional()),
  location: z.preprocess(blank, z.string().trim().max(200).optional()),
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(1440),
  attendeeIds: z.array(z.uuid()).max(MAX_ATTENDEES).default([]),
  contactId: z.preprocess(blank, z.uuid().optional()),
});

export const rescheduleSchema = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(1440),
});

export const responseSchema = z.enum(["ACCEPTED", "DECLINED"]);
export const appointmentIdSchema = z.uuid();
