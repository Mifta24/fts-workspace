import { z } from "zod";
import { isValidTimeZone } from "@/lib/time-zone";

export const DURATION_CHOICES = [15, 20, 30, 45, 60, 90, 120] as const;
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const BOOKINGS_PER_MINUTE = 10;
export const BOOKINGS_PER_DAY = 100;
/** Upcoming meetings one email address may hold through one page. */
export const UPCOMING_PER_EMAIL = 2;
export const MAX_PUBLIC_BODY_CHARS = 4_000;
export const HONEYPOT_FIELD = "website";

export const bookingPageIdSchema = z.uuid();
export const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
export const statusSchema = z.enum(["DRAFT", "PUBLISHED", "CLOSED"]);

const blank = (value: unknown) => (value === "" || value === null ? undefined : value);

const timeZone = z.string().trim().refine(isValidTimeZone, "Choose a valid time zone.");
/** `HH:mm` from an `<input type="time">`, as minutes after midnight. */
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .transform((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)));

const settings = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.preprocess(blank, z.string().trim().max(1000).optional()),
  location: z.preprocess(blank, z.string().trim().max(200).optional()),
  durationMinutes: z.coerce
    .number()
    .int()
    .refine((value) => (DURATION_CHOICES as readonly number[]).includes(value)),
  timeZone,
  weekdays: z
    .array(z.coerce.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  start: clock,
  end: clock,
  minNoticeHours: z.coerce.number().int().min(0).max(720).default(4),
  maxDaysAhead: z.coerce.number().int().min(1).max(90).default(30),
});

const hoursAreSane = (value: { start: number; end: number; durationMinutes: number }) =>
  value.end > value.start && value.end - value.start >= value.durationMinutes;

export const createBookingPageSchema = settings
  .extend({ consentText: z.string().trim().min(10).max(500) })
  .refine(hoursAreSane, { message: "The working hours must fit at least one slot." });

export const updateBookingPageSchema = settings
  .extend({ consentText: z.string().trim().min(10).max(500).optional() })
  .refine(hoursAreSane, { message: "The working hours must fit at least one slot." });

export const visitorBookingSchema = z.object({
  startsAt: z.coerce.date(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  note: z.preprocess(blank, z.string().trim().max(500).optional()),
});
