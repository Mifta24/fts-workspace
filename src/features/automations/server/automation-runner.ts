import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { FOLLOW_UP_DAYS, jobPayloadSchema } from "@/features/automations/schemas/automations";
import {
  createNotifications,
  publishNotifications,
} from "@/features/notifications/server/notification-service";
import type { ClaimedJob } from "@/server/jobs/queue";
import { recordAuditEvent } from "@/server/services/audit";

type Tx = Prisma.TransactionClient;
type Notified = Awaited<ReturnType<typeof createNotifications>>;

const DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");
const utcMinute = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;

/**
 * Worker side of one automation. Everything is read again from the database for the job's own
 * organization, so the job's identifiers can never reach another tenant's data, and a rule that
 * was switched off, an owner who left or a contact that was erased since the job was queued
 * simply does nothing. The action and the "this ran" marker commit together, so a job that runs
 * twice acts once. Rules only ever act inside the workspace: no email, no message outside it,
 * nothing is deleted.
 */
export async function runAutomation(
  { prisma }: { prisma: PrismaClient },
  job: ClaimedJob,
  now: Date = new Date(),
): Promise<void> {
  const parsed = jobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new Error("Invalid automation payload");
  const payload = parsed.data;
  const organizationId = job.organizationId;

  const notified = await prisma.$transaction(async (tx): Promise<Notified> => {
    const rule = await tx.automationRule.findUnique({
      where: { organizationId_ruleKey: { organizationId, ruleKey: payload.ruleKey } },
      select: { enabled: true },
    });
    if (!rule?.enabled) return [];
    const subjectId = "submissionId" in payload ? payload.submissionId : payload.appointmentId;
    const claimed = await tx.automationRun.createMany({
      data: [{ organizationId, ruleKey: payload.ruleKey, subjectId }],
      skipDuplicates: true,
    });
    if (claimed.count === 0) return [];

    const audit = (resourceType: string, resourceId: string) =>
      recordAuditEvent(tx, {
        organizationId,
        actorId: null,
        action: "automation.executed",
        resourceType,
        resourceId,
        metadata: { ruleKey: payload.ruleKey, subjectId },
      });

    if (payload.ruleKey === "BOOKING_RECEIVED_NOTE") {
      const appointment = await tx.appointment.findFirst({
        where: { id: payload.appointmentId, organizationId, bookingPageId: { not: null } },
        select: { id: true, title: true, startsAt: true, organizerId: true, contactId: true },
      });
      if (
        !appointment?.contactId ||
        !(await activeMember(tx, organizationId, appointment.organizerId))
      ) {
        return [];
      }
      const contact = await tx.crmContact.findFirst({
        where: { id: appointment.contactId, organizationId, erasedAt: null },
        select: { id: true },
      });
      if (!contact) return [];
      await tx.crmActivity.create({
        data: {
          organizationId,
          contactId: contact.id,
          type: "NOTE",
          body: `Booked a meeting: ${appointment.title} (${utcMinute(appointment.startsAt)})`,
          authorId: appointment.organizerId,
          occurredAt: now,
        },
      });
      await audit("appointment", appointment.id);
      return [];
    }

    // The two form rules: the submission must belong to this form, in this organization.
    const form = await tx.form.findFirst({
      where: {
        id: payload.formId,
        organizationId,
        submissions: { some: { id: payload.submissionId, organizationId } },
      },
      select: { id: true, title: true, ownerId: true },
    });
    if (!form || !(await activeMember(tx, organizationId, form.ownerId))) return [];

    if (payload.ruleKey === "FORM_SUBMITTED_NOTIFY") {
      const created = await createNotifications(tx, [
        {
          organizationId,
          userId: form.ownerId,
          type: "FORM_SUBMITTED",
          actorId: null,
          resourceType: "form",
          resourceId: form.id,
        },
      ]);
      await audit("form", form.id);
      return created;
    }

    // The task carries the form's name only, never what the visitor wrote.
    const task = await tx.task.create({
      data: {
        organizationId,
        title: `Follow up: ${form.title}`.slice(0, 200),
        description: "Created by an automation when this form was submitted.",
        assigneeId: form.ownerId,
        createdById: form.ownerId,
        dueAt: new Date(now.getTime() + FOLLOW_UP_DAYS * DAY),
      },
      select: { id: true },
    });
    await audit("task", task.id);
    return createNotifications(tx, [
      {
        organizationId,
        userId: form.ownerId,
        type: "TASK_ASSIGNED",
        actorId: null,
        resourceType: "task",
        resourceId: task.id,
      },
    ]);
  });
  await publishNotifications(notified);
}

async function activeMember(tx: Tx, organizationId: string, userId: string): Promise<boolean> {
  const member = await tx.member.findFirst({
    where: { organizationId, userId, status: "ACTIVE" },
    select: { id: true },
  });
  return member !== null;
}
