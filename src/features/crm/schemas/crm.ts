import { z } from "zod";

export const CONTACT_CONSENT = ["GRANTED", "WITHDRAWN"] as const;
export const DEAL_STAGES = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
export const JOURNEY_STAGES = ["LEAD", "PROSPECT", "CUSTOMER", "LAPSED"] as const;
export const journeyStageSchema = z.enum(JOURNEY_STAGES);
export const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING"] as const;

export const idSchema = z.uuid();

const blank = (value: unknown) => (value === "" || value === null ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());
/** For updates: "" clears (null), omitted leaves unchanged. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? null : value), schema.nullable().optional());

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const phone = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[0-9+()\-.\s]+$/, "Digits, spaces and + ( ) - . only");

export const consentSchema = z.object({
  status: z.enum(CONTACT_CONSENT),
  /** How consent was given or withdrawn. Required so there is always a record of the basis. */
  source: z.string().trim().min(3).max(120),
});

export const createContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: optional(email),
  phone: optional(phone),
  company: optional(z.string().trim().max(120)),
  ownerId: optional(z.uuid()),
  consentStatus: optional(z.enum(CONTACT_CONSENT)),
  consentSource: optional(z.string().trim().min(3).max(120)),
});

export const updateContactSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: clearable(email),
    phone: clearable(phone),
    company: clearable(z.string().trim().max(120)),
    ownerId: z.uuid(),
  })
  .partial();

export const createDealSchema = z.object({
  contactId: z.uuid(),
  title: z.string().trim().min(2).max(160),
  amount: optional(z.coerce.number().min(0).max(1_000_000_000)),
  currency: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
  ),
  expectedCloseAt: optional(z.coerce.date()),
  ownerId: optional(z.uuid()),
});

export const stageSchema = z.enum(DEAL_STAGES);

export const activitySchema = z.object({
  contactId: z.uuid(),
  dealId: optional(z.uuid()),
  type: z.enum(ACTIVITY_TYPES),
  body: z.string().trim().min(1).max(2000),
  occurredAt: optional(z.coerce.date()),
});

export const searchSchema = z.string().trim().max(100);

export type CreateContactInput = z.infer<typeof createContactSchema>;
