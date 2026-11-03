import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { dueAfter } from "@/features/organizations/schemas/deletion";
import type { PurgeActor, PurgeResult } from "@/features/organizations/schemas/purge";
import { recordAuditEvent } from "@/server/services/audit";
import type { StoragePort } from "@/server/storage/storage";

type Deps = { prisma: PrismaClient; storage: StoragePort; correlationId?: string };
type Tx = Prisma.TransactionClient;
type Where = { organizationId: string };

/**
 * Every table with an `organizationId` column, children before the tables their rows point at (a
 * test reads the database's foreign keys and fails if this order or this list is wrong). Rows are
 * always deleted with `organizationId` in the filter. `audit_logs` goes last of the deletes.
 */
const PURGE_STEPS: readonly (readonly [
  string,
  (tx: Tx, where: Where) => Promise<{ count: number }>,
])[] = [
  ["form_submissions", (tx, where) => tx.formSubmission.deleteMany({ where })],
  ["forms", (tx, where) => tx.form.deleteMany({ where })],
  ["appointment_attendees", (tx, where) => tx.appointmentAttendee.deleteMany({ where })],
  ["appointments", (tx, where) => tx.appointment.deleteMany({ where })],
  ["booking_pages", (tx, where) => tx.bookingPage.deleteMany({ where })],
  ["task_due_reminders", (tx, where) => tx.taskDueReminder.deleteMany({ where })],
  ["task_comments", (tx, where) => tx.taskComment.deleteMany({ where })],
  ["ai_task_plans", (tx, where) => tx.aiTaskPlan.deleteMany({ where })],
  ["milestones", (tx, where) => tx.milestone.deleteMany({ where })],
  [
    "tasks",
    async (tx, where) => {
      // A subtask points at its parent with a RESTRICT key; cut the links first.
      await tx.task.updateMany({ where, data: { parentTaskId: null } });
      return tx.task.deleteMany({ where });
    },
  ],
  [
    "goals",
    async (tx, where) => {
      await tx.goal.updateMany({ where, data: { parentGoalId: null } });
      return tx.goal.deleteMany({ where });
    },
  ],
  ["projects", (tx, where) => tx.project.deleteMany({ where })],
  ["consent_events", (tx, where) => tx.consentEvent.deleteMany({ where })],
  ["contact_stage_changes", (tx, where) => tx.contactStageChange.deleteMany({ where })],
  ["crm_activities", (tx, where) => tx.crmActivity.deleteMany({ where })],
  ["crm_deals", (tx, where) => tx.crmDeal.deleteMany({ where })],
  ["crm_contacts", (tx, where) => tx.crmContact.deleteMany({ where })],
  ["automation_runs", (tx, where) => tx.automationRun.deleteMany({ where })],
  ["automation_rules", (tx, where) => tx.automationRule.deleteMany({ where })],
  ["calendar_feeds", (tx, where) => tx.calendarFeed.deleteMany({ where })],
  ["calendar_connections", (tx, where) => tx.calendarConnection.deleteMany({ where })],
  ["document_chunks", (tx, where) => tx.documentChunk.deleteMany({ where })],
  ["knowledge_documents", (tx, where) => tx.knowledgeDocument.deleteMany({ where })],
  ["file_shares", (tx, where) => tx.fileShare.deleteMany({ where })],
  ["files", (tx, where) => tx.fileObject.deleteMany({ where })],
  ["notifications", (tx, where) => tx.notification.deleteMany({ where })],
  ["messages", (tx, where) => tx.message.deleteMany({ where })],
  ["channel_members", (tx, where) => tx.channelMember.deleteMany({ where })],
  ["channels", (tx, where) => tx.channel.deleteMany({ where })],
  ["point_events", (tx, where) => tx.pointEvent.deleteMany({ where })],
  ["challenges", (tx, where) => tx.challenge.deleteMany({ where })],
  ["jobs", (tx, where) => tx.job.deleteMany({ where })],
  ["ai_usage_events", (tx, where) => tx.aiUsageEvent.deleteMany({ where })],
  ["invitations", (tx, where) => tx.invitation.deleteMany({ where })],
  ["members", (tx, where) => tx.member.deleteMany({ where })],
  ["subscriptions", (tx, where) => tx.subscription.deleteMany({ where })],
  ["audit_logs", (tx, where) => tx.auditLog.deleteMany({ where })],
];

export const PURGE_TABLE_NAMES: readonly string[] = PURGE_STEPS.map(([name]) => name);

/**
 * Removes everything a workspace owns once its owner's deletion request has passed the waiting
 * period. The rules are re-checked here, whoever calls: the request still stands, the date has
 * passed, and the workspace is not purged yet. The organization row stays as a tombstone (renamed,
 * no personal data) so the final audit event keeps its foreign key and the slug is free again.
 * Calling it again, or after a failure, is safe.
 */
export async function purgeWorkspace(
  { prisma, storage, correlationId }: Deps,
  input: { organizationId: string; actor: PurgeActor },
  now: Date = new Date(),
): Promise<PurgeResult> {
  const { organizationId, actor } = input;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { purgedAt: true, deletionRequestedAt: true },
  });
  if (!organization) throw new AppError("NOT_FOUND", "Workspace not found.");
  const already: PurgeResult = {
    organizationId,
    alreadyPurged: true,
    filesRemoved: 0,
    rowCounts: {},
  };
  if (organization.purgedAt) return already;
  assertDue(organization.deletionRequestedAt, now);

  // Bytes go first: if this fails nothing in the database has changed and a retry starts over. The
  // prefix sweep also removes bytes that no row points at; it runs before the per-file deletes so
  // its count includes every file on disk.
  const onDisk = await storage.deletePrefix(organizationId);
  const files = await prisma.fileObject.findMany({
    where: { organizationId },
    select: { storageKey: true },
  });
  for (const file of files) await storage.delete(file.storageKey);
  const filesRemoved = Math.max(files.length, onDisk);

  return prisma.$transaction(
    async (tx) => {
      // The lock makes a second purge wait; it then sees the tombstone and does nothing.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const locked = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { purgedAt: true, deletionRequestedAt: true },
      });
      if (locked.purgedAt) return already;
      assertDue(locked.deletionRequestedAt, now);

      // Lets the append-only tables delete this organization's rows, and only until the transaction ends.
      await tx.$executeRaw`SELECT set_config('app.purge_org', ${organizationId}, true)`;
      const rowCounts: Record<string, number> = {};
      for (const [name, run] of PURGE_STEPS) {
        rowCounts[name] = (await run(tx, { organizationId })).count;
      }

      const token = `deleted-${organizationId.replaceAll("-", "")}`;
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          name: token,
          slug: token,
          purgedAt: now,
          suspendedAt: null,
          deletionRequestedAt: null,
          deletionRequestedBy: null,
          leaderboardVisibility: "OFF",
          aiDailyTokenBudget: 200000,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorId: actor.userId,
        action: "organization.purged",
        resourceType: "organization",
        resourceId: organizationId,
        metadata: { trigger: actor.trigger, filesRemoved, rowCounts },
        correlationId,
      });
      return { organizationId, alreadyPurged: false, filesRemoved, rowCounts };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

function assertDue(requestedAt: Date | null, now: Date): void {
  if (!requestedAt) {
    throw new AppError(
      "UNPROCESSABLE",
      "The owner has not asked for this workspace to be deleted.",
    );
  }
  if (now < dueAfter(requestedAt)) {
    throw new AppError("UNPROCESSABLE", "The waiting period for this workspace is not over yet.");
  }
}
