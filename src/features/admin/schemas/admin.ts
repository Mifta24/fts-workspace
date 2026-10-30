import { z } from "zod";

export const MAX_TRIAL_DAYS = 90;

/** UNMETERED removes the subscription: no plan limits apply to the workspace. */
export const setPlanSchema = z.object({
  organizationId: z.uuid(),
  plan: z.enum(["FREE", "TEAM", "BUSINESS", "UNMETERED"]),
  /** Present: a trial of this many days on `plan`. Absent: the plan is active. */
  trialDays: z.coerce.number().int().min(1).max(MAX_TRIAL_DAYS).optional(),
});

export const setSuspendedSchema = z.object({
  organizationId: z.uuid(),
  suspended: z.boolean(),
});

export const searchSchema = z.string().trim().max(80);
