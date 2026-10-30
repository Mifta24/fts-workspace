import type { Prisma } from "@/generated/prisma/client";
import {
  AUTOMATION_JOB,
  BOOKING_RULES,
  FORM_RULES,
} from "@/features/automations/schemas/automations";
import { enqueueJob } from "@/server/jobs/queue";

export type AutomationEvent =
  | { type: "form.submitted"; formId: string; submissionId: string }
  | { type: "booking.received"; appointmentId: string };

/**
 * Queues one job for each rule that is switched on for this event. Called inside the
 * transaction of whatever caused the event, so a rule never runs for something that was rolled
 * back, and the dedupe key keeps a retried request from queueing the same rule twice. Rules
 * switched on later do not touch earlier events.
 */
export async function queueAutomations(
  tx: Pick<Prisma.TransactionClient, "automationRule" | "job">,
  organizationId: string,
  event: AutomationEvent,
): Promise<void> {
  const keys = event.type === "form.submitted" ? FORM_RULES : BOOKING_RULES;
  const enabled = await tx.automationRule.findMany({
    where: { organizationId, enabled: true, ruleKey: { in: [...keys] } },
    select: { ruleKey: true },
  });
  const subjectId = event.type === "form.submitted" ? event.submissionId : event.appointmentId;
  for (const { ruleKey } of enabled) {
    await enqueueJob(tx, {
      organizationId,
      type: AUTOMATION_JOB,
      payload:
        event.type === "form.submitted"
          ? { ruleKey, formId: event.formId, submissionId: event.submissionId }
          : { ruleKey, appointmentId: event.appointmentId },
      dedupeKey: `automation:${ruleKey}:${subjectId}`,
    });
  }
}
