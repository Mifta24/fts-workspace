import { z } from "zod";

export const AUTOMATION_JOB = "automation.run";

/** The built-in rules. There is no rule language: each one is fixed code (ADR-018). */
export const RULE_KEYS = [
  "FORM_SUBMITTED_NOTIFY",
  "FORM_SUBMITTED_TASK",
  "BOOKING_RECEIVED_NOTE",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export const ruleKeySchema = z.enum(RULE_KEYS);

export const FORM_RULES: readonly RuleKey[] = ["FORM_SUBMITTED_NOTIFY", "FORM_SUBMITTED_TASK"];
export const BOOKING_RULES: readonly RuleKey[] = ["BOOKING_RECEIVED_NOTE"];

/** The follow-up task is due this many days after the submission. */
export const FOLLOW_UP_DAYS = 2;

/** What a queued job carries: identifiers only, never what a visitor typed. */
export const jobPayloadSchema = z.union([
  z.object({
    ruleKey: z.enum(["FORM_SUBMITTED_NOTIFY", "FORM_SUBMITTED_TASK"]),
    formId: z.uuid(),
    submissionId: z.uuid(),
  }),
  z.object({ ruleKey: z.literal("BOOKING_RECEIVED_NOTE"), appointmentId: z.uuid() }),
]);

export const setRuleSchema = z.object({
  ruleKey: ruleKeySchema,
  enabled: z.boolean(),
});
