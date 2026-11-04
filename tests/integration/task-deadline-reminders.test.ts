import { beforeEach, describe, expect, it } from "vitest";
import { listNotifications } from "@/features/notifications/server/notification-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { sendDueSoonReminders } from "@/features/tasks/server/deadline-reminders";
import { db } from "@/lib/db";
import { createTestOrganization, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const HOUR = 3_600_000;
const NOW = new Date("2040-01-02T08:00:00Z");
const inHours = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", { alice: "MEMBER", bob: "MEMBER" });
  const globex = await createTestOrganization("globex", { gina: "MEMBER" });
  const task = (
    organizationId: string,
    createdById: string,
    overrides: Record<string, unknown> = {},
  ) =>
    db().task.create({
      data: {
        organizationId,
        createdById,
        title: "Send the report",
        assigneeId: acme.users.alice!.id,
        dueAt: inHours(12),
        ...overrides,
      },
    });
  return { acme, globex, task };
}

const notifications = (slug: string, userId: string) =>
  contextFor(slug, userId).then((context) => listNotifications(deps(), context));

describe("task deadline reminders", () => {
  beforeEach(resetDatabase);

  it("tells the assignee once that a task is due within a day", async () => {
    const { acme, task } = await setup();
    const created = await task(acme.organization.id, acme.users.owner!.id);

    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 1 });
    // Running the sweep again, even much later, sends nothing new for the same due date.
    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 0 });
    expect(await sendDueSoonReminders(deps(), inHours(3))).toEqual({ reminded: 0 });

    const mine = await notifications("acme", acme.users.alice!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      type: "TASK_DUE_SOON",
      actorName: null,
      resourceType: "task",
      resourceId: created.id,
      resourceTitle: "Send the report",
    });
    expect(await notifications("acme", acme.users.bob!.id)).toHaveLength(0);
    expect(await notifications("acme", acme.users.owner!.id)).toHaveLength(0);
    expect(await db().taskDueReminder.count()).toBe(1);
  });

  it("leaves out tasks that are not open, not assigned, not due yet or already overdue", async () => {
    const { acme, task } = await setup();
    const org = acme.organization.id;
    const by = acme.users.owner!.id;
    await task(org, by, { dueAt: inHours(25) }); // not yet inside the window
    await task(org, by, { dueAt: inHours(-1) }); // overdue
    await task(org, by, { dueAt: null });
    await task(org, by, { assigneeId: null });
    await task(org, by, { status: "COMPLETED", completedAt: NOW });
    await task(org, by, { status: "CANCELLED" });

    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 0 });
    expect(await db().notification.count()).toBe(0);
    // The 25-hour task comes into the window an hour later.
    expect(await sendDueSoonReminders(deps(), inHours(2))).toEqual({ reminded: 1 });
  });

  it("reminds again for a new due date, and the new assignee after a reassignment", async () => {
    const { acme, task } = await setup();
    const created = await task(acme.organization.id, acme.users.owner!.id);
    await sendDueSoonReminders(deps(), NOW);
    await db().notification.updateMany({ data: { readAt: NOW } });

    await db().task.update({ where: { id: created.id }, data: { dueAt: inHours(20) } });
    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 1 });

    await db().task.update({
      where: { id: created.id },
      data: { assigneeId: acme.users.bob!.id },
    });
    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 1 });
    expect(await notifications("acme", acme.users.bob!.id)).toHaveLength(1);
  });

  it("does not remind someone who is no longer an active member", async () => {
    const { acme, task } = await setup();
    await task(acme.organization.id, acme.users.owner!.id);
    await db().member.updateMany({
      where: { organizationId: acme.organization.id, userId: acme.users.alice!.id },
      data: { status: "DISABLED" },
    });

    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 0 });
    expect(await db().notification.count()).toBe(0);
  });

  it("waits while a workspace is suspended, then reminds once it is restored", async () => {
    const { acme, task } = await setup();
    await task(acme.organization.id, acme.users.owner!.id);
    await db().organization.update({
      where: { id: acme.organization.id },
      data: { suspendedAt: NOW },
    });
    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 0 });

    await db().organization.update({
      where: { id: acme.organization.id },
      data: { suspendedAt: null },
    });
    expect(await sendDueSoonReminders(deps(), NOW)).toEqual({ reminded: 1 });
  });

  it("keeps each workspace to its own people", async () => {
    const { acme, globex, task } = await setup();
    await task(acme.organization.id, acme.users.owner!.id);
    await task(globex.organization.id, globex.users.owner!.id, {
      title: "Globex plan",
      assigneeId: globex.users.gina!.id,
    });
    // A task whose assignee belongs only to another workspace cannot reach that person.
    await task(acme.organization.id, acme.users.owner!.id, {
      title: "Cross-wired",
      assigneeId: globex.users.gina!.id,
    });

    await sendDueSoonReminders(deps(), NOW);

    const gina = await notifications("globex", globex.users.gina!.id);
    expect(gina.map((item) => item.resourceTitle)).toEqual(["Globex plan"]);
    const stored = await db().notification.findMany({ orderBy: { createdAt: "asc" } });
    for (const row of stored) {
      const task = await db().task.findUniqueOrThrow({ where: { id: row.resourceId } });
      expect(row.organizationId).toBe(task.organizationId);
    }
  });
});
